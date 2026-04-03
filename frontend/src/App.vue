<script setup>
import { ref } from 'vue';
import axios from 'axios';

// API基础URL
const API_BASE_URL = 'http://localhost:3000';

// 索引相关状态
const directoryPath = ref('');
const isIndexing = ref(false);
const indexStatus = ref('');
const csvFileName = ref('');

// 文件上传相关状态
const uploadedFile = ref(null);
const uploadStatus = ref('');
const isUploading = ref(false);
const csvFileInput = ref(null);

// 搜索相关状态
const searchTerm = ref('');
const searchResults = ref([]);
const isSearching = ref(false);
const searchHistory = ref([]);
const isSearchingCompleted = ref(false);

// 表单验证规则
const validateDirectoryPath = () => {
  if (!directoryPath.value.trim()) {
    indexStatus.value = '请输入目录路径';
    return false;
  }
  return true;
};

// 执行目录索引
const indexDirectory = async () => {
  if (!validateDirectoryPath()) return;
  
  isIndexing.value = true;
  indexStatus.value = '正在索引目录...';
  
  // 添加进度更新定时器
  let progressInterval;
  let progressCounter = 0;
  const progressMessages = [
    '正在索引目录...',
    '正在扫描文件...',
    '正在收集文件信息...',
    '正在处理文件数据...'
  ];
  
  // 每5秒更新一次进度提示，避免用户以为程序卡住
  progressInterval = setInterval(() => {
    if (isIndexing.value) {
      progressCounter = (progressCounter + 1) % progressMessages.length;
      indexStatus.value = progressMessages[progressCounter];
    }
  }, 5000);
  
  try {
    // 设置请求超时，防止长时间无响应
    const response = await axios.post(`${API_BASE_URL}/api/index`, {
      directoryPath: directoryPath.value
    }, {
      timeout: 3600000, // 1小时超时
      onDownloadProgress: (progressEvent) => {
        // 虽然POST请求没有真正的进度，但可以模拟进度反馈
        if (progressEvent) {
          console.log('索引进度更新');
        }
      }
    });
    
    // 清除进度定时器
    clearInterval(progressInterval);
    
    if (response.data && response.data.success) {
      indexStatus.value = `索引成功！共找到 ${response.data.totalFiles || 0} 个文件`;
      csvFileName.value = response.data.csvFilePath;
      // 自动搜索选项：可以在这里添加自动搜索逻辑
    } else {
      indexStatus.value = `索引失败: ${response.data?.error || '未知错误'}`;
    }
  } catch (error) {
    // 清除进度定时器
    clearInterval(progressInterval);
    
    if (error.code === 'ECONNABORTED') {
      indexStatus.value = '索引超时，请尝试索引更小的目录';
    } else if (error.response) {
      indexStatus.value = `请求错误: ${error.response.data?.error || error.message}`;
    } else if (error.request) {
      indexStatus.value = '网络错误: 无法连接到服务器';
    } else {
      indexStatus.value = `请求错误: ${error.message}`;
    }
    console.error('索引错误:', error);
  } finally {
    isIndexing.value = false;
  }
};

// 下载CSV文件
const downloadCsv = () => {
  if (!csvFileName.value) {
    indexStatus.value = '没有可下载的CSV文件';
    return;
  }
  
  window.open(`${API_BASE_URL}/api/download/${csvFileName.value}`, '_blank');
};

// 上传CSV文件
const uploadCsvFile = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  
  // 验证文件类型
  if (!file.name.endsWith('.csv')) {
    uploadStatus.value = '请上传CSV格式的文件';
    return;
  }
  
  uploadedFile.value = file;
  uploadStatus.value = `已选择文件: ${file.name}`;
};

// 执行搜索
const searchFiles = async () => {
  if (!searchTerm.value.trim()) {
    indexStatus.value = '请输入搜索关键词';
    return;
  }
  
  if (!csvFileName.value && !uploadedFile.value) {
    indexStatus.value = '请先索引目录或上传CSV文件';
    return;
  }
  
  isSearching.value = true;
  indexStatus.value = '正在搜索...';
  searchResults.value = []; // 清空之前的搜索结果
  
  try {
    // 根据是使用索引生成的文件还是上传的文件来选择不同的搜索方式
    if (uploadedFile.value) {
      // 使用FormData上传文件并搜索
      const formData = new FormData();
      formData.append('file', uploadedFile.value);
      formData.append('searchTerm', searchTerm.value);
      
      const response = await axios.post(`${API_BASE_URL}/api/search/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      if (response.data.success) {
        searchResults.value = response.data.results || [];
        const totalResults = response.data.total !== undefined ? response.data.total : searchResults.value.length;
        
        // 显示更详细的状态信息
        if (totalResults > 0) {
          indexStatus.value = `找到 ${totalResults} 个匹配项`;
        } else {
          indexStatus.value = `未找到匹配项，请尝试其他关键词`;
          
          // 如果有调试信息，添加到控制台以便排查问题
          if (response.data.debugInfo) {
            console.log('搜索调试信息:', response.data.debugInfo);
          }
        }
      } else {
        indexStatus.value = `搜索失败: ${response.data.error}`;
      }
    } else {
      // 使用索引生成的文件进行搜索
      const response = await axios.post(`${API_BASE_URL}/api/search`, {
        csvFileName: csvFileName.value,
        searchTerm: searchTerm.value
      });
      
      if (response.data.success) {
        searchResults.value = response.data.results || [];
        indexStatus.value = `找到 ${response.data.total || 0} 个匹配项`;
      } else {
        indexStatus.value = `搜索失败: ${response.data.error}`;
      }
    }
    
    // 保存到搜索历史
    if (!searchHistory.value.includes(searchTerm.value)) {
      searchHistory.value.unshift(searchTerm.value);
      if (searchHistory.value.length > 10) {
        searchHistory.value.pop();
      }
    }
  } catch (error) {
    indexStatus.value = `请求错误: ${error.message}`;
  } finally {
    isSearching.value = false;
    isSearchingCompleted.value = true;
  }
};

// 清除上传的文件
const clearUploadedFile = () => {
  uploadedFile.value = null;
  uploadStatus.value = '';
  // 清空文件输入框
  if (csvFileInput.value) {
    csvFileInput.value.value = '';
  }
};

// 打开文件选择对话框
const openFileDialog = () => {
  if (csvFileInput.value) {
    csvFileInput.value.click();
  }
};

// 从历史记录中选择搜索词
const selectHistoryTerm = (term) => {
  searchTerm.value = term;
  searchFiles();
};

// 清除搜索历史
const clearHistory = () => {
  searchHistory.value = [];
};

// 格式化文件大小显示（注意：后端已将文件大小转换为KB）
const formatFileSize = (size) => {
  if (!size) return '0 KB';
  const numSize = Number(size);
  if (isNaN(numSize)) return size;
  
  // 因为后端已将文件大小转换为KB，所以这里直接处理KB单位的数据
  if (numSize >= 1024) {
    return (numSize / 1024).toFixed(2) + ' MB';
  }
  return numSize.toFixed(2) + ' KB';
};
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <h1>本地硬盘文件索引工具</h1>
      <p>索引本地文件并进行快速搜索</p>
    </header>
    
    <main class="app-main">
      <!-- 目录索引部分 -->
      <section class="index-section">
        <h2>文件索引</h2>
        <div class="index-form">
          <div class="input-group">
            <label for="directoryPath">目录路径:</label>
            <input 
              id="directoryPath"
              v-model="directoryPath"
              type="text" 
              placeholder="例如: C:\Users\Documents"
              :disabled="isIndexing"
            />
          </div>
          <div class="button-group">
            <button 
              @click="indexDirectory" 
              :disabled="isIndexing"
              class="primary-button"
            >
              {{ isIndexing ? '索引中...' : '开始索引' }}
            </button>
            <button 
              @click="downloadCsv" 
              :disabled="!csvFileName || isIndexing"
              class="secondary-button"
            >
              下载CSV
            </button>
          </div>
        </div>
        
        <!-- CSV文件上传部分 -->
        <div class="upload-section">
          <h3>或上传CSV文件</h3>
          <div class="upload-form">
            <div class="input-group">
              <label for="csvFileInput">选择CSV文件:</label>
              <div class="file-input-wrapper">
                <input 
                  ref="csvFileInput"
                  type="file" 
                  accept=".csv"
                  @change="uploadCsvFile"
                  style="display: none;"
                />
                <button 
                  type="button"
                  @click="openFileDialog"
                  class="secondary-button file-input-button"
                >
                  选择文件
                </button>
                <span v-if="uploadedFile" class="file-name">{{ uploadedFile.name }}</span>
                <button 
                  v-if="uploadedFile" 
                  @click="clearUploadedFile"
                  class="clear-file-button"
                  title="清除文件"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
          <div v-if="uploadStatus" class="status-message">
            {{ uploadStatus }}
          </div>
        </div>
        
        <div v-if="indexStatus" class="status-message">
          {{ indexStatus }}
        </div>
      </section>
      
      <!-- 文件搜索部分 -->
      <section class="search-section">
        <h2>文件搜索</h2>
        <div class="search-form">
          <div class="input-group">
            <label for="searchTerm">搜索关键词:</label>
            <input 
              id="searchTerm"
              v-model="searchTerm" 
              type="text" 
              placeholder="输入文件名或路径关键词"
              :disabled="isSearching"
              @keyup.enter="searchFiles"
            />
          </div>
          <button 
            @click="searchFiles" 
            :disabled="isSearching || !searchTerm.trim()"
            class="primary-button"
          >
            {{ isSearching ? '搜索中...' : '搜索' }}
          </button>
        </div>
        
        <!-- 搜索历史 -->
        <div v-if="searchHistory.length > 0" class="search-history">
          <span>搜索历史:</span>
          <button 
            v-for="(term, index) in searchHistory" 
            :key="index"
            @click="selectHistoryTerm(term)"
            class="history-tag"
          >
            {{ term }}
          </button>
          <button @click="clearHistory" class="clear-history">清除</button>
        </div>
        
        <!-- 搜索结果 -->
        <div v-if="searchResults.length > 0" class="search-results">
          <h3>搜索结果 ({{ searchResults.length }})</h3>
          <table class="results-table">
            <thead>
              <tr>
                <th>文件路径</th>
                <th>大小</th>
                <th>修改时间</th>
                <th>创建者</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(result, index) in searchResults" :key="index">
                <td class="file-path">{{ result.path }}</td>
                <td class="file-size">{{ formatFileSize(result.size) }}</td>
                <td class="file-modified">{{ result.modifiedTime }}</td>
                <td class="file-creator">{{ result.creator || '未知' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <!-- 无结果提示 -->
        <div v-if="!isSearching && searchTerm.trim() && searchResults.length === 0 && (searchHistory.length > 0 || isSearchingCompleted)" class="no-results">
          没有找到匹配的文件
        </div>
      </section>
    </main>
    
    <footer class="app-footer">
      <p>本地硬盘文件索引工具 &copy; {{ new Date().getFullYear() }}</p>
    </footer>
  </div>
</template>

<style>
/* 全局样式 */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  line-height: 1.6;
  color: #333;
  background-color: #f5f5f5;
}

/* 应用容器 */
.app-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

/* 页头 */
.app-header {
  text-align: center;
  margin-bottom: 40px;
  padding: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 8px;
}

.app-header h1 {
  font-size: 2.5rem;
  margin-bottom: 10px;
}

/* 主内容 */
.app-main {
  display: flex;
  flex-direction: column;
  gap: 40px;
}

/* 通用部分样式 */
section {
  background: white;
  padding: 30px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

section h2 {
  margin-bottom: 20px;
  color: #333;
  border-bottom: 2px solid #667eea;
  padding-bottom: 10px;
}

/* 表单样式 */
.index-form, .search-form {
  display: flex;
  flex-direction: column;
  gap: 15px;
  margin-bottom: 20px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-group label {
  font-weight: 500;
  color: #555;
}

.input-group input {
  padding: 12px 15px;
  border: 2px solid #ddd;
  border-radius: 6px;
  font-size: 1rem;
  transition: border-color 0.3s;
}

.input-group input:focus {
  outline: none;
  border-color: #667eea;
}

.input-group input:disabled {
  background-color: #f5f5f5;
  cursor: not-allowed;
}

/* 文件上传样式 */
.upload-section {
  margin-top: 30px;
  padding-top: 20px;
  border-top: 1px solid #eee;
}

.upload-section h3 {
  margin-bottom: 15px;
  color: #555;
  font-size: 1.1rem;
}

.upload-form {
  margin-bottom: 15px;
}

.file-input-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.file-input-button {
  min-width: 100px;
}

.file-name {
  flex: 1;
  min-width: 200px;
  padding: 10px 15px;
  background-color: #f8f9fa;
  border-radius: 6px;
  border: 1px solid #ddd;
  word-break: break-all;
}

.clear-file-button {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background-color: #ff6b6b;
  color: white;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.3s;
}

.clear-file-button:hover {
  background-color: #ff5252;
}

/* 按钮样式 */
.button-group {
  display: flex;
  gap: 10px;
}

.primary-button, .secondary-button {
  padding: 12px 24px;
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s;
}

.primary-button {
  background-color: #667eea;
  color: white;
}

.primary-button:hover:not(:disabled) {
  background-color: #5a5fd0;
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(102, 126, 234, 0.3);
}

.secondary-button {
  background-color: #e0e0e0;
  color: #333;
}

.secondary-button:hover:not(:disabled) {
  background-color: #d0d0d0;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none !important;
}

/* 状态消息 */
.status-message {
  padding: 10px 15px;
  border-radius: 6px;
  background-color: #f8f9fa;
  border-left: 4px solid #667eea;
  font-size: 0.9rem;
}

/* 搜索历史 */
.search-history {
  margin: 20px 0;
  padding: 15px;
  background-color: #f8f9fa;
  border-radius: 6px;
}

.search-history span {
  font-weight: 500;
  margin-right: 10px;
}

.history-tag {
  padding: 5px 10px;
  margin: 5px;
  background-color: #e9ecef;
  border: none;
  border-radius: 15px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background-color 0.3s;
}

.history-tag:hover {
  background-color: #dee2e6;
}

.clear-history {
  padding: 5px 10px;
  margin-left: 10px;
  background-color: #ff6b6b;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background-color 0.3s;
}

.clear-history:hover {
  background-color: #ff5252;
}

/* 搜索结果表格 */
.search-results h3 {
  margin-bottom: 15px;
  color: #333;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
}

.results-table th, .results-table td {
  padding: 12px 15px;
  text-align: left;
  border-bottom: 1px solid #ddd;
}

.results-table th {
  background-color: #667eea;
  color: white;
  font-weight: 500;
}

.results-table tr:hover {
  background-color: #f8f9fa;
}

.file-path {
  max-width: 600px;
  word-break: break-all;
}

.file-size, .file-modified, .file-creator {
  width: 150px;
}

/* 无结果提示 */
.no-results {
  padding: 20px;
  text-align: center;
  color: #666;
  font-style: italic;
  background-color: #f8f9fa;
  border-radius: 6px;
  margin-top: 20px;
}

/* 页脚 */
.app-footer {
  text-align: center;
  margin-top: 40px;
  padding: 20px;
  color: #666;
  font-size: 0.9rem;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .app-container {
    padding: 10px;
  }
  
  .app-header h1 {
    font-size: 2rem;
  }
  
  section {
    padding: 20px;
  }
  
  .button-group {
    flex-direction: column;
  }
  
  .results-table {
    display: block;
    overflow-x: auto;
  }
}
</style>
