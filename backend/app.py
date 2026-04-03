from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import os
import csv
import time
import platform
import shutil
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
import uuid
import getpass  # 用于获取当前用户名

app = Flask(__name__)
CORS(app)

# 配置
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB文件大小限制

# 确保临时文件目录存在
temp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'temp')
if not os.path.exists(temp_dir):
    os.makedirs(temp_dir)

# 获取当前操作系统类型
def get_os():
    plat = platform.system().lower()
    if plat == 'windows':
        return 'windows'
    elif plat == 'darwin':
        return 'macos'
    return 'linux'  # 假设是Ubuntu或其他Linux发行版

# 生成唯一的CSV文件名
def generate_csv_filename():
    return f'file_index_{int(time.time())}.csv'

# 安全验证函数
def validate_path(dir_path):
    # 防止路径遍历攻击
    normalized_path = os.path.normpath(dir_path)
    if not os.path.exists(normalized_path):
        raise ValueError('指定的目录不存在')
    
    try:
        # 验证是否为目录
        if not os.path.isdir(normalized_path):
            raise ValueError('指定的路径不是一个目录')
        return normalized_path
    except Exception as e:
        raise ValueError(f'无法访问指定目录: {str(e)}')

# 递归遍历目录并索引文件
def index_directory(dir_path):
    csv_filename = generate_csv_filename()
    csv_path = os.path.join(temp_dir, csv_filename)
    
    # 记录文件信息
    files_info = []
    processed_files = 0
    
    # 递归遍历函数
    def traverse_directory(current_path):
        nonlocal processed_files
        try:
            items = os.listdir(current_path)
            
            for item in items:
                item_path = os.path.join(current_path, item)
                
                try:
                    # 检查是否有权限访问
                    if not os.access(item_path, os.R_OK):
                        print(f'警告: 无权限访问 {item_path}')
                        continue
                    
                    if os.path.isdir(item_path):
                        # 递归遍历子目录
                        traverse_directory(item_path)
                    else:
                        # 收集文件信息
                        stats = os.stat(item_path)
                        
                        # 获取文件创建者信息
                        creator = "未知"
                        try:
                            # 根据不同操作系统获取文件所有者信息
                            if get_os() == 'windows':
                                # Windows系统尝试通过win32api获取
                                try:
                                    import win32security
                                    sd = win32security.GetFileSecurity(item_path, win32security.OWNER_SECURITY_INFORMATION)
                                    owner_sid = sd.GetSecurityDescriptorOwner()
                                    name, domain, type = win32security.LookupAccountSid(None, owner_sid)
                                    creator = f"{domain}\\{name}"
                                except ImportError:
                                    # 如果没有win32security模块，使用当前用户
                                    creator = getpass.getuser()
                            else:
                                # Linux/Mac系统
                                try:
                                    import pwd
                                    uid = stats.st_uid
                                    user_info = pwd.getpwuid(uid)
                                    creator = user_info.pw_name
                                except (ImportError, KeyError):
                                    creator = getpass.getuser()
                        except Exception as e:
                            print(f'获取文件所有者信息失败 {item_path}: {str(e)}')
                            creator = getpass.getuser()
                        
                        files_info.append({
                            'path': item_path,
                            'size': round(stats.st_size / 1024, 2),  # 转换为KB
                            'modifiedTime': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(stats.st_mtime)),
                            'creator': creator
                        })
                        processed_files += 1
                except Exception as e:
                    print(f'警告: 无法访问文件 {item_path}: {str(e)}')
                    # 继续处理其他文件，不中断整个过程
        except Exception as e:
            print(f'警告: 无法访问目录 {current_path}: {str(e)}')
            # 继续处理其他目录，不中断整个过程
    
    # 执行遍历
    traverse_directory(dir_path)
    
    # 写入CSV文件
    with open(csv_path, 'w', newline='', encoding='utf-8') as csvfile:
        fieldnames = ['path', 'size', 'modifiedTime', 'creator']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        
        # 写入标题行
        writer.writeheader()
        
        # 写入数据行
        for file_info in files_info:
            writer.writerow({
                'path': file_info['path'],
                'size': file_info['size'],
                'modifiedTime': file_info['modifiedTime'],
                'creator': file_info['creator']
            })
    
    print(f'成功索引了 {len(files_info)} 个文件')
    return csv_path

# API路由：索引文件
@app.route('/api/index', methods=['POST'])
def api_index():
    try:
        data = request.get_json()
        if not data or 'directoryPath' not in data:
            return jsonify({'error': '请提供有效的目录路径'}), 400
        
        directory_path = data['directoryPath']
        
        # 安全验证路径
        normalized_path = validate_path(directory_path)
        
        # 开始索引
        csv_file_path = index_directory(normalized_path)
        
        # 计算总行数（减去标题行）
        total_files = 0
        with open(csv_file_path, 'r', encoding='utf-8') as f:
            total_files = sum(1 for _ in f) - 1
        
        return jsonify({
            'success': True,
            'message': '目录索引完成',
            'csvFilePath': os.path.basename(csv_file_path),
            'totalFiles': total_files
        })
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# API路由：搜索文件
@app.route('/api/search', methods=['POST'])
def api_search():
    try:
        data = request.get_json()
        if not data or 'csvFileName' not in data or 'searchTerm' not in data:
            return jsonify({'error': '请提供CSV文件名和搜索关键词'}), 400
        
        csv_file_name = data['csvFileName']
        search_term = data['searchTerm']
        sort_by = data.get('sortBy')
        sort_order = data.get('sortOrder', 'asc')
        
        # 安全检查文件名
        safe_file_name = secure_filename(csv_file_name)
        csv_path = os.path.join(temp_dir, safe_file_name)
        
        if not os.path.exists(csv_path):
            return jsonify({'error': '找不到指定的CSV文件'}), 404
        
        # 读取并搜索CSV文件
        results = []
        search_lower = search_term.lower()
        
        with open(csv_path, 'r', encoding='utf-8') as csvfile:
            reader = csv.DictReader(csvfile)
            for row in reader:
                # 检查搜索词是否在文件路径、大小或修改时间中
                if (search_lower in row.get('path', '').lower() or 
                    search_term in str(row.get('size', '')) or 
                    search_term in str(row.get('modifiedTime', '')) or
                    search_lower in str(row.get('creator', '')).lower()):
                    results.append({
                        'path': row.get('path', ''),
                        'size': row.get('size', ''),
                        'modifiedTime': row.get('modifiedTime', ''),
                        'creator': row.get('creator', '')
                    })
        
        # 排序功能
        if sort_by in ['path', 'size', 'modifiedTime', 'creator']:
            results.sort(key=lambda x: (
                float(x[sort_by]) if sort_by == 'size' and x[sort_by] else x[sort_by]
            ), reverse=(sort_order == 'desc'))
        
        return jsonify({
            'success': True,
            'results': results,
            'total': len(results)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# API路由：下载CSV文件
@app.route('/api/download/<filename>', methods=['GET'])
def api_download(filename):
    # 安全检查：防止路径遍历攻击
    safe_filename = secure_filename(filename)
    csv_path = os.path.join(temp_dir, safe_filename)
    
    if not os.path.exists(csv_path):
        return jsonify({'error': '找不到指定的CSV文件'}), 404
    
    try:
        return send_file(csv_path, as_attachment=True, download_name=safe_filename)
    except Exception as e:
        return jsonify({'error': '文件下载失败'}), 500

# API路由：获取可用的索引文件列表
@app.route('/api/index-files', methods=['GET'])
def api_get_index_files():
    try:
        files = []
        for file in os.listdir(temp_dir):
            if file.endswith('.csv'):
                file_path = os.path.join(temp_dir, file)
                stats = os.stat(file_path)
                # 计算行数（减去标题行）
                total_rows = 0
                with open(file_path, 'r', encoding='utf-8') as f:
                    total_rows = sum(1 for _ in f) - 1
                
                files.append({
                    'fileName': file,
                    'size': stats.st_size,
                    'createdTime': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(stats.st_ctime)),
                    'totalRows': total_rows
                })
        
        # 按创建时间降序排序
        files.sort(key=lambda x: x['createdTime'], reverse=True)
        
        return jsonify({
            'success': True,
            'files': files
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# API路由：删除索引文件
@app.route('/api/index-files/<filename>', methods=['DELETE'])
def api_delete_index_file(filename):
    try:
        # 安全检查文件名
        safe_filename = secure_filename(filename)
        csv_path = os.path.join(temp_dir, safe_filename)
        
        if not os.path.exists(csv_path):
            return jsonify({'error': '找不到指定的CSV文件'}), 404
        
        os.remove(csv_path)
        
        return jsonify({
            'success': True,
            'message': '索引文件已成功删除'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# API路由：搜索上传的CSV文件
@app.route('/api/search/upload', methods=['POST'])
def api_search_upload():
    try:
        if 'file' not in request.files or not request.form.get('searchTerm'):
            return jsonify({'error': '请提供CSV文件和搜索关键词'}), 400
        
        file = request.files['file']
        search_term = request.form['searchTerm']
        
        # 检查文件扩展名
        if not file.filename.endswith('.csv'):
            return jsonify({'error': '只接受CSV格式的文件'}), 400
        
        print(f'开始搜索上传的CSV文件，文件名: {file.filename}，搜索关键词: {search_term}')
        
        # 保存上传的文件到临时位置
        temp_file_name = f'temp_{uuid.uuid4().hex}.csv'
        temp_file_path = os.path.join(temp_dir, temp_file_name)
        file.save(temp_file_path)
        
        try:
            # 读取并搜索CSV文件
            results = []
            search_lower = search_term.lower()
            total_rows = 0
            first_row_data = None
            
            with open(temp_file_path, 'r', encoding='utf-8') as csvfile:
                reader = csv.DictReader(csvfile)
                for row in reader:
                    total_rows += 1
                    # 记录第一行数据用于调试
                    if not first_row_data:
                        first_row_data = dict(row)
                        print('CSV文件列名:', list(first_row_data.keys()))
                    
                    # 适配不同的CSV格式，查找可能的列名
                    path_column = None
                    size_column = None
                    time_column = None
                    
                    # 尝试识别列名
                    for key, value in row.items():
                        if value:
                            clean_key = key.strip().replace('"', '').lower()
                            clean_value = str(value).strip().replace('"', '')
                            
                            if not path_column and ('path' in clean_key or 'fullname' in clean_key or '文件路径' in clean_key):
                                path_column = clean_value
                            elif not size_column and ('size' in clean_key or 'length' in clean_key or '大小' in clean_key):
                                size_column = clean_value
                            elif not time_column and ('time' in clean_key or 'lastwritetime' in clean_key or 'modified' in clean_key):
                                time_column = clean_value
                            elif 'creator' in clean_key or 'owner' in clean_key or '创建者' in clean_key:
                                creator_column = clean_value
                    # 确保creator_column已初始化
                    if 'creator_column' not in locals():
                        creator_column = None
                    
                    # 如果找不到标准列名，尝试第一个非空值作为路径
                    if not path_column:
                        for value in row.values():
                            if value and isinstance(value, str) and len(value) > 0:
                                path_column = value
                                break
                    
                    # 执行搜索
                    is_match = False
                    if path_column and isinstance(path_column, str):
                        is_match = search_lower in path_column.lower()
                    
                    if not is_match and size_column:
                        is_match = search_term in str(size_column)
                    
                    if not is_match and time_column and isinstance(time_column, str):
                        is_match = search_term in time_column
                    
                    if is_match:
                        results.append({
                            'path': path_column or '未知路径',
                            'size': size_column or '未知大小',
                            'modifiedTime': time_column or '未知时间',
                            'creator': creator_column or '未知创建者'
                        })
            
            print(f'CSV文件解析完成，总共解析 {total_rows} 行，找到 {len(results)} 个匹配结果')
            return jsonify({
                'success': True,
                'results': results,
                'total': len(results),
                'debugInfo': {
                    'totalRows': total_rows,
                    'fileSize': os.path.getsize(temp_file_path),
                    'firstRowSample': list(first_row_data.keys())[:3] if first_row_data else None
                }
            })
        finally:
            # 清理临时文件
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
    except RequestEntityTooLarge:
        return jsonify({'error': '文件大小超过限制（50MB）'}), 413
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# API路由：AI分析接口（预留）
@app.route('/api/analyze', methods=['POST'])
def api_analyze():
    try:
        data = request.get_json()
        if not data or 'csvFileName' not in data:
            return jsonify({'error': '请提供CSV文件名'}), 400
        
        csv_file_name = data['csvFileName']
        safe_file_name = secure_filename(csv_file_name)
        csv_path = os.path.join(temp_dir, safe_file_name)
        
        if not os.path.exists(csv_path):
            return jsonify({'error': '找不到指定的CSV文件'}), 404
        
        # 这里是预留的AI分析接口，未来可以接入阿里云DashScope
        # 当前返回模拟数据
        return jsonify({
            'success': True,
            'message': 'AI分析接口已预留，未来可接入阿里云DashScope',
            'analysis': {
                'totalFiles': 500,  # 模拟数据
                'fileTypes': ['pdf', 'docx', 'xlsx', 'jpg', 'png'],
                'largestFile': '示例文件路径',
                'mostRecentFile': time.strftime('%Y-%m-%d %H:%M:%S'),
                'topCreators': ['user1', 'user2', 'user3']  # 添加创建者统计
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# 全局错误处理
@app.errorhandler(Exception)
def handle_exception(e):
    print(f'服务器错误: {str(e)}')
    return jsonify({'error': '服务器内部错误', 'message': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    print(f'文件索引服务器运行在 http://localhost:{port}')
    print('API接口:')
    print('  POST   /api/index          - 创建文件索引')
    print('  POST   /api/search         - 搜索文件')
    print('  POST   /api/search/upload  - 搜索上传的CSV文件')
    print('  GET    /api/download/<filename> - 下载索引文件')
    print('  GET    /api/index-files    - 获取索引文件列表')
    print('  DELETE /api/index-files/<filename> - 删除索引文件')
    print('  POST   /api/analyze        - AI分析（预留）')
    
    # 在生产环境中应使用更安全的配置
    app.run(host='0.0.0.0', port=port, debug=False)