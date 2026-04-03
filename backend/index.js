const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const multer = require('multer');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件设置
app.use(cors());
app.use(express.json());

// 确保临时文件目录存在
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// 配置multer用于文件上传
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        // 只接受CSV文件
        if (path.extname(file.originalname) !== '.csv') {
            return cb(new Error('只接受CSV格式的文件'));
        }
        cb(null, true);
    },
    limits: {
        fileSize: 50 * 1024 * 1024 // 限制文件大小为50MB
    }
});

// 生成唯一的CSV文件名
const generateCsvFileName = () => {
    return `file_index_${Date.now()}.csv`;
};

// 安全验证函数
const validatePath = (dirPath) => {
    // 防止路径遍历攻击
    const normalizedPath = path.normalize(dirPath);
    if (!fs.existsSync(normalizedPath)) {
        throw new Error('指定的目录不存在');
    }
    
    try {
        // 验证是否为目录
        const stats = fs.statSync(normalizedPath);
        if (!stats.isDirectory()) {
            throw new Error('指定的路径不是一个目录');
        }
        return normalizedPath;
    } catch (error) {
        throw new Error(`无法访问指定目录: ${error.message}`);
    }
};

// 获取文件创建者信息（跨平台实现）
const getFileCreator = async (filePath) => {
    try {
        if (process.platform === 'win32') {
            // Windows系统使用PowerShell获取文件所有者
            const { stdout } = await exec(`powershell -Command "(Get-Acl '${filePath.replace(/'/g, "''")}').Owner"`);
            return stdout.trim() || '未知';
        } else {
            // Linux/Mac系统使用stat命令获取所有者
            const { stdout } = await exec(`stat -c '%U' '${filePath.replace(/'/g, "''")}'`);
            return stdout.trim() || '未知';
        }
    } catch (error) {
        console.warn(`获取文件创建者失败 ${filePath}: ${error.message}`);
        return '未知';
    }
};

// 文件系统索引模块 - 使用系统自带的文件递归查找命令行工具
const indexDirectory = async (dirPath) => {
    const csvFileName = generateCsvFileName();
    const csvPath = path.join(tempDir, csvFileName);
    
    // 创建CSV写入器
    const csvWriter = createCsvWriter({
        path: csvPath,
        header: [
            {id: 'path', title: '文件路径'},
            {id: 'size', title: '文件大小(KB)'},
            {id: 'modifiedTime', title: '最后修改时间'},
            {id: 'creator', title: '文件创建者'}
        ]
    });
    
    let command = '';
    let filesInfo = [];
    
    try {
        console.log(`开始索引目录: ${dirPath}`);
        
        // 根据不同系统选择不同的命令
        if (process.platform === 'win32') {
            // Windows系统使用PowerShell，使用最简单的命令格式
            const safePath = dirPath.replace(/'/g, "''");
            // 创建一个简单的脚本块，避免复杂的引号转义
            // 添加OutputEncoding设置确保中文等非ASCII字符正确输出
            const psScript = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8; Get-ChildItem -Path '${safePath}' -Recurse -File | ForEach-Object { \$acl = Get-Acl \$_.FullName; \$_.FullName + '|' + [math]::Round(\$_.Length/1024, 2) + '|' + \$_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') + '|' + \$acl.Owner }`;
            // 使用-EncodedCommand避免引号问题（Base64编码）
            const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
            command = `powershell -EncodedCommand ${encodedCommand}`;
        } else if (process.platform === 'darwin') {
            // macOS系统使用find命令，设置正确的LC_ALL确保非ASCII字符正确处理
            command = `LC_ALL=en_US.UTF-8 find '${dirPath.replace(/'/g, "''")}' -type f -exec sh -c "echo '{}|$(stat -f %z '{}')|$(stat -f %Sm -t '%Y-%m-%d %H:%M:%S' '{}')|$(stat -f %Su '{}')'" \;`;
        } else {
            // Linux系统使用find命令，设置正确的LC_ALL确保非ASCII字符正确处理
            command = `LC_ALL=en_US.UTF-8 find '${dirPath.replace(/'/g, "''")}' -type f -exec stat --format='%N|%s|%y|%U' {} \;`;
        }
        
        console.log(`执行命令: ${command}`);
        
        // 执行命令并获取输出，确保正确处理编码
        const { stdout, stderr } = await exec(command, { encoding: 'utf8' });
        
        if (stderr && stderr.trim()) {
            console.warn(`命令执行警告: ${stderr}`);
        }
        
        // 解析输出结果
        const lines = stdout.trim().split('\n');
        console.log(`获取到 ${lines.length} 个文件记录`);
        
        for (let i = 0; i < lines.length; i++) {
            try {
                const line = lines[i].trim();
                if (!line) continue;
                
                const parts = line.split('|');
                if (parts.length < 3) {
                    console.warn(`行格式不正确: ${line}`);
                    continue;
                }
                
                // 处理不同系统的输出格式差异
                let filePath = parts[0];
                // 移除Linux/macOS中stat命令添加的单引号
                if ((process.platform === 'darwin' || process.platform === 'linux') && 
                    filePath.startsWith("'") && filePath.endsWith("'") && filePath.length > 2) {
                    filePath = filePath.substring(1, filePath.length - 1);
                }
                // 确保文件路径使用正确的编码
                if (process.platform === 'win32') {
                    // Windows系统可能需要额外处理编码
                    filePath = filePath.replace(/\\/g, '/');
                }
                
                const size = Math.round(parseFloat(parts[1]) / 1024 * 100) / 100;
                let modifiedTime = parts[2];
                // 格式化Linux中的时间字符串
                if (process.platform === 'linux' && modifiedTime.includes('.')) {
                    modifiedTime = modifiedTime.split('.')[0].replace(' ', 'T').replace('T', ' ');
                }
                
                // 处理创建者信息（如果存在）
                let creator = '未知';
                if (parts.length >= 4) {
                    creator = parts[3].trim();
                }
                
                filesInfo.push({
                    path: filePath,
                    size: size,
                    modifiedTime: modifiedTime,
                    creator: creator
                });
                
                // 每处理1000个文件记录一次进度
                if (i % 1000 === 0) {
                    console.log(`已处理 ${i} 个文件`);
                }
            } catch (lineError) {
                console.warn(`处理行失败: ${lines[i]} - ${lineError.message}`);
                continue;
            }
        }
        
        console.log(`文件信息收集完成，共 ${filesInfo.length} 个文件`);
        
        // 写入CSV文件
        await csvWriter.writeRecords(filesInfo);
        console.log(`CSV文件已写入: ${csvPath}`);
        
        return { csvFileName, csvPath, totalFiles: filesInfo.length };
    } catch (error) {
        console.error(`索引过程中出错: ${error.message}`);
        // 如果系统命令失败，回退到Node.js原生方法
        console.log('回退到Node.js原生方法进行索引');
        return await fallbackIndexDirectory(dirPath);
    }
};

// 回退方案：使用Node.js原生方法进行索引
const fallbackIndexDirectory = async (dirPath) => {
    const csvFileName = generateCsvFileName();
    const csvPath = path.join(tempDir, csvFileName);
    
    // 创建CSV写入器
    const csvWriter = createCsvWriter({
        path: csvPath,
        header: [
            {id: 'path', title: '文件路径'},
            {id: 'size', title: '文件大小(KB)'},
            {id: 'modifiedTime', title: '最后修改时间'},
            {id: 'creator', title: '文件创建者'}
        ]
    });
    
    // 递归遍历目录
    const filesInfo = [];
    const traverseDirectory = async (currentPath) => {
        try {
            const files = fs.readdirSync(currentPath);
            
            for (const file of files) {
                const filePath = path.join(currentPath, file);
                
                try {
                    const stats = fs.statSync(filePath);
                    
                    if (stats.isDirectory()) {
                        // 递归遍历子目录
                        await traverseDirectory(filePath);
                    } else {
                        // 收集文件信息，尝试获取创建者
                        let creator = '未知';
                        try {
                            creator = await getFileCreator(filePath);
                        } catch (e) {
                            console.warn(`获取文件创建者失败 ${filePath}: ${e.message}`);
                        }
                        
                        filesInfo.push({
                            path: filePath,
                            size: Math.round(stats.size / 1024 * 100) / 100, // 转换为KB并保留两位小数
                            modifiedTime: new Date(stats.mtime).toLocaleString('zh-CN'),
                            creator: creator
                        });
                    }
                } catch (error) {
                    console.warn(`无法访问文件 ${filePath}: ${error.message}`);
                    // 继续处理其他文件，不中断整个过程
                }
            }
        } catch (error) {
            console.warn(`无法访问目录 ${currentPath}: ${error.message}`);
            // 继续处理其他目录，不中断整个过程
        }
    };
    
    // 执行遍历
    await traverseDirectory(dirPath);
    
    // 写入CSV文件
    await csvWriter.writeRecords(filesInfo);
    
    return { csvFileName, csvPath, totalFiles: filesInfo.length };
};

// API路由: 索引目录
app.post('/api/index', async (req, res) => {
    try {
        const { directoryPath } = req.body;
        
        if (!directoryPath) {
            return res.status(400).json({ success: false, error: '未提供目录路径' });
        }
        
        // 验证路径
        const validatedPath = validatePath(directoryPath);
        
        // 执行索引
        const result = await indexDirectory(validatedPath);
        
        return res.json({
            success: true,
            csvFilePath: result.csvFileName,
            message: `成功索引 ${result.totalFiles} 个文件`,
            totalFiles: result.totalFiles
        });
    } catch (error) {
        console.error('索引过程中出错:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// API路由: 搜索文件
app.post('/api/search', async (req, res) => {
    try {
        const { csvFileName, searchTerm } = req.body;
        
        if (!csvFileName || !searchTerm) {
            return res.status(400).json({ success: false, error: 'CSV文件名和搜索关键词不能为空' });
        }
        
        const csvPath = path.join(tempDir, csvFileName);
        
        if (!fs.existsSync(csvPath)) {
            return res.status(404).json({ success: false, error: 'CSV文件不存在' });
        }
        
        // 读取并搜索CSV文件
        const results = [];
        const searchRegex = new RegExp(searchTerm, 'i'); // 不区分大小写搜索
        
        await new Promise((resolve, reject) => {
            fs.createReadStream(csvPath)
                .pipe(csvParser())
                .on('data', (row) => {
                    // 搜索文件名或路径
                    if (searchRegex.test(row['文件路径']) || 
                        searchRegex.test(path.basename(row['文件路径'])) ||
                        searchRegex.test(row['文件创建者'] || '')) {
                        results.push({
                            path: row['文件路径'],
                            size: parseFloat(row['文件大小(KB)']),
                            modifiedTime: row['最后修改时间'],
                            creator: row['文件创建者'] || '未知'
                        });
                    }
                })
                .on('end', () => resolve())
                .on('error', (error) => reject(error));
        });
        
        return res.json({
            success: true,
            results: results,
            totalResults: results.length
        });
    } catch (error) {
        console.error('搜索过程中出错:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// API路由: 上传CSV文件并搜索
app.post('/api/search/upload', upload.single('file'), async (req, res) => {
    try {
        const { searchTerm } = req.body;
        
        if (!req.file || !searchTerm) {
            return res.status(400).json({ success: false, error: '请提供CSV文件和搜索关键词' });
        }
        
        // 将文件内容转换为流进行解析
        const results = [];
        const searchRegex = new RegExp(searchTerm, 'i');
        
        // 创建可读流
        const fileContent = req.file.buffer.toString('utf8');
        const readableStream = require('stream').Readable;
        const stream = new readableStream();
        stream._read = () => {};
        stream.push(fileContent);
        stream.push(null);
        
        await new Promise((resolve, reject) => {
            stream
                .pipe(csvParser())
                .on('data', (row) => {
                    // 查找文件路径字段（支持多种可能的字段名）
                    const pathField = row['文件路径'] || row.path || row.Path || row['path'] || '';
                    const sizeField = row['文件大小(KB)'] || row.size || row.Size || '';
                    const timeField = row['最后修改时间'] || row.modifiedTime || row.ModifiedTime || '';
                    const creatorField = row['文件创建者'] || row.creator || row.Creator || '';
                    
                    if (searchRegex.test(pathField) || 
                        searchRegex.test(path.basename(pathField)) ||
                        searchRegex.test(creatorField)) {
                        results.push({
                            path: pathField,
                            size: sizeField,
                            modifiedTime: timeField,
                            creator: creatorField || '未知'
                        });
                    }
                })
                .on('end', () => resolve())
                .on('error', (error) => reject(error));
        });
        
        return res.json({
            success: true,
            results: results,
            totalResults: results.length
        });
    } catch (error) {
        console.error('搜索上传文件错误:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// API路由：获取可用的索引文件列表
app.get('/api/index-files', (req, res) => {
    try {
        const files = fs.readdirSync(tempDir)
            .filter(file => file.endsWith('.csv'))
            .map(file => {
                const stats = fs.statSync(path.join(tempDir, file));
                return {
                    fileName: file,
                    size: stats.size,
                    createdTime: stats.ctime.toISOString().replace('T', ' ').substring(0, 19),
                    totalRows: fs.readFileSync(path.join(tempDir, file), 'utf8').split('\n').length - 1
                };
            })
            .sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
        
        res.json({
            success: true,
            files
        });
    } catch (error) {
        console.error('获取索引文件列表错误:', error);
        res.status(500).json({ error: '获取索引文件列表失败' });
    }
});

// API路由：删除索引文件
app.delete('/api/index-files/:fileName', (req, res) => {
    try {
        const fileName = req.params.fileName;
        const safeFileName = path.basename(fileName); // 防止路径遍历
        const filePath = path.join(tempDir, safeFileName);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: '索引文件不存在' });
        }
        
        fs.unlinkSync(filePath);
        
        return res.json({
            success: true,
            message: '索引文件已成功删除'
        });
    } catch (error) {
        console.error('删除索引文件错误:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// API路由：下载CSV文件
app.get('/api/download/:fileName', (req, res) => {
    try {
        const fileName = req.params.fileName;
        const safeFileName = path.basename(fileName); // 防止路径遍历
        const filePath = path.join(tempDir, safeFileName);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: '文件不存在' });
        }
        
        res.download(filePath, safeFileName, (err) => {
            if (err) {
                console.error('文件下载错误:', err);
                res.status(500).json({ success: false, error: '文件下载失败' });
            }
        });
    } catch (error) {
        console.error('下载文件错误:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// API路由：AI分析接口（预留）
app.post('/api/analyze', async (req, res) => {
    try {
        const { csvFileName } = req.body;
        
        if (!csvFileName) {
            return res.status(400).json({ error: '请提供CSV文件名' });
        }
        
        const csvPath = path.join(tempDir, csvFileName);
        
        if (!fs.existsSync(csvPath)) {
            return res.status(404).json({ error: '找不到指定的CSV文件' });
        }
        
        // 这里是预留的AI分析接口，未来可以接入阿里云DashScope
        // 当前返回模拟数据
        res.json({
            success: true,
            message: 'AI分析接口已预留，未来可接入阿里云DashScope',
            analysis: {
                totalFiles: Math.floor(Math.random() * 1000) + 100,
                fileTypes: ['pdf', 'docx', 'xlsx', 'jpg', 'png'],
                largestFile: '示例文件路径',
                mostRecentFile: new Date().toISOString().replace('T', ' ').substring(0, 19)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 添加错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err.stack);
    res.status(500).json({
        error: '服务器内部错误',
        message: process.env.NODE_ENV === 'development' ? err.message : '请联系管理员'
    });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`文件索引服务器运行在 http://localhost:${PORT}`);
    console.log(`API接口:`);
    console.log(`  POST   /api/index          - 创建文件索引`);
    console.log(`  POST   /api/search         - 搜索文件`);
    console.log(`  POST   /api/search/upload  - 搜索上传的CSV文件`);
    console.log(`  GET    /api/download/:fileName - 下载索引文件`);
    console.log(`  GET    /api/index-files    - 获取索引文件列表`);
    console.log(`  DELETE /api/index-files/:fileName - 删除索引文件`);
    console.log(`  POST   /api/analyze        - AI分析（预留）`);
});