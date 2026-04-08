<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import axios from 'axios';

const API = 'http://localhost:3000';

const apiKey  = ref(localStorage.getItem('fi_key') || '');
const http    = () => axios.create({ headers: apiKey.value ? {'X-API-Key': apiKey.value} : {} });

// ── View ──────────────────────────────────────────────────────────────────────
const view = ref('search');

// ── Indexes ───────────────────────────────────────────────────────────────────
const indexes     = ref([]);
const activeIndex = ref(null);
const idxMenuOpen = ref(false);

// ── Search (metadata) ─────────────────────────────────────────────────────────
const query     = ref('');
const nlqMode   = ref(true);
const fuzzyMode = ref(false);
const extFilter = ref('');
const sortBy    = ref('');
const sortOrder = ref('asc');
const results   = ref([]);
const total     = ref(0);
const page      = ref(1);
const totalPgs  = ref(1);
const pageSize  = ref(100);
const extStats  = ref([]);
const tokens    = ref([]);
const isSearch  = ref(false);
const searchDone= ref(false);
const durMs     = ref(0);
const history   = ref(JSON.parse(localStorage.getItem('fi_hist')||'[]'));

// ── Content search ────────────────────────────────────────────────────────────
const contentMode    = ref(false);
const contentResults = ref([]);
const contentTotal   = ref(0);
const contentPg      = ref(1);
const contentTotalPgs= ref(1);
const contentDone    = ref(false);
const contentDurMs   = ref(0);
const contentError   = ref('');

// ── Preview ───────────────────────────────────────────────────────────────────
const selIdx         = ref(-1);
const preview        = ref(null);
const prevLoading    = ref(false);

// ── Scan ──────────────────────────────────────────────────────────────────────
const newPath       = ref('');
const newName       = ref('');
const inclContent   = ref(false);
const isIndexing    = ref(false);
const scanProg      = ref({processed:0,skipped:0,contentDone:0,message:'',phase:''});
const scanMsg       = ref('');

// ── Stats / Audit / Dupes / Timeline ──────────────────────────────────────────
const stats    = ref(null);
const audit    = ref([]);
const auditTotal= ref(0);
const auditFilter = ref('');
const dupes    = ref([]);
const timeline = ref([]);

// ── Settings ──────────────────────────────────────────────────────────────────
const cfg    = ref({ignorePatterns:[],fuzzyThreshold:55,apiKeyEnabled:false,newKey:'',newPat:''});
const caps   = ref({pdf:false,docx:false,xlsx:false});
const cfgMsg = ref('');

// ── Rename ────────────────────────────────────────────────────────────────────
const renaming  = ref(null);
const renameVal = ref('');

const sysInfo = ref({fuzzyEngine:'',pinyinAvailable:false});

const searchRef = ref(null);

// ── Init ──────────────────────────────────────────────────────────────────────
onMounted(async () => {
  await loadIndexes(); await loadStatus(); await loadCfg();
  document.addEventListener('keydown', onKey);
  nextTick(() => searchRef.value?.focus());
});
onUnmounted(() => document.removeEventListener('keydown', onKey));
watch(history, v => localStorage.setItem('fi_hist', JSON.stringify(v)));
watch(apiKey,  v => localStorage.setItem('fi_key', v));

const loadIndexes = async () => {
  try {
    const {data} = await http().get(`${API}/api/indexes`);
    if (data.success) {
      indexes.value = data.indexes;
      if (!activeIndex.value) {
        const done = data.indexes.find(i=>i.status==='done');
        if (done) activeIndex.value = done;
      }
    }
  } catch {}
};
const loadStatus = async () => {
  try {
    const {data} = await http().get(`${API}/api/status`);
    sysInfo.value = data; caps.value = data.capabilities || {};
  } catch {}
};
const loadCfg = async () => {
  try {
    const {data} = await http().get(`${API}/api/settings`);
    if (data.success) {
      cfg.value.ignorePatterns = data.ignorePatterns||[];
      cfg.value.fuzzyThreshold = data.fuzzyThreshold??55;
      cfg.value.apiKeyEnabled  = data.apiKeyEnabled||false;
      caps.value = data.capabilities || {};
    }
  } catch {}
};
const loadStats = async () => {
  if (!activeIndex.value) return;
  try { const {data} = await http().get(`${API}/api/stats/${activeIndex.value.id}`); if(data.success) stats.value=data; } catch {}
};
const loadAudit = async () => {
  if (!activeIndex.value) return;
  try {
    const url = `${API}/api/audit/${activeIndex.value.id}?limit=200${auditFilter.value?'&action='+auditFilter.value:''}`;
    const {data} = await http().get(url);
    if (data.success) { audit.value=data.logs; auditTotal.value=data.total; }
  } catch {}
};
const loadDupes = async () => {
  if (!activeIndex.value) return;
  try { const {data} = await http().get(`${API}/api/duplicates/${activeIndex.value.id}`); if(data.success) dupes.value=data.groups; } catch {}
};
const loadTimeline = async () => {
  if (!activeIndex.value) return;
  try { const {data} = await http().get(`${API}/api/timeline/${activeIndex.value.id}?days=14`); if(data.success) timeline.value=data.files; } catch {}
};

// ── Search ────────────────────────────────────────────────────────────────────
let searchTimer = null;
watch(query, () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearch(1), 280); });
watch([nlqMode, fuzzyMode, extFilter, sortBy, sortOrder, contentMode], () => doSearch(1));

const doSearch = async (pg=1) => {
  if (!activeIndex.value) return;
  isSearch.value=true; searchDone.value=false; contentDone.value=false; contentError.value='';
  if (pg===1) { results.value=[]; contentResults.value=[]; selIdx.value=-1; preview.value=null; }

  if (contentMode.value) {
    await doContentSearch(pg);
  } else {
    await doMetaSearch(pg);
  }
  isSearch.value=false;
};

const doMetaSearch = async (pg) => {
  try {
    const {data} = await http().post(`${API}/api/search`, {
      indexId:activeIndex.value.id, searchTerm:query.value,
      nlq:nlqMode.value, fuzzy:fuzzyMode.value,
      extFilter:extFilter.value, sortBy:sortBy.value, sortOrder:sortOrder.value,
      page:pg, pageSize:pageSize.value,
    });
    if (data.success) {
      results.value=data.results; total.value=data.total;
      page.value=data.page; totalPgs.value=data.totalPages;
      extStats.value=data.extStats||[]; tokens.value=data.tokens||[];
      durMs.value=data.durationMs||0;
      if (results.value.length) { selIdx.value=0; fetchPreview(results.value[0]); }
    }
  } catch {}
  finally { searchDone.value=true; }
  const q=query.value.trim();
  if(q && !history.value.includes(q)) history.value=[q,...history.value].slice(0,10);
};

const doContentSearch = async (pg) => {
  contentError.value='';
  try {
    const {data} = await http().post(`${API}/api/search/content`, {
      indexId:activeIndex.value.id, query:query.value,
      extFilter:extFilter.value, page:pg, pageSize:50,
    });
    if (data.success) {
      contentResults.value=data.results; contentTotal.value=data.total;
      contentPg.value=data.page; contentTotalPgs.value=data.totalPages;
      contentDurMs.value=data.durationMs||0;
      if (contentResults.value.length) { selIdx.value=0; fetchPreview(contentResults.value[0]); }
    }
  } catch(err) {
    contentError.value = err.response?.data?.error || '搜索失败';
  }
  finally { contentDone.value=true; }
};

const fetchPreview = async (row) => {
  if (!row) { preview.value=null; return; }
  prevLoading.value=true;
  try {
    const {data} = await http().post(`${API}/api/preview`,{path:row.path});
    if (data.success) preview.value={...data.file, snippet: row.snippet, score:row.score};
  } catch { preview.value={name:row.name,path:row.path,size_kb:row.size,modified:row.modifiedTime,ext:row.ext,content:null}; }
  finally { prevLoading.value=false; }
};

const onKey = (e) => {
  if (e.key==='/' && document.activeElement!==searchRef.value) { e.preventDefault(); searchRef.value?.focus(); return; }
  if (e.key==='Escape') { query.value=''; searchRef.value?.focus(); return; }
  const list = contentMode.value ? contentResults.value : results.value;
  if (!list.length) return;
  if (e.key==='ArrowDown') { e.preventDefault(); moveResult(1, list); }
  if (e.key==='ArrowUp')   { e.preventDefault(); moveResult(-1, list); }
};
const moveResult = (d, list) => {
  const next=Math.max(0,Math.min(list.length-1,selIdx.value+d));
  selIdx.value=next; fetchPreview(list[next]);
  nextTick(() => document.getElementById(`row-${next}`)?.scrollIntoView({block:'nearest'}));
};
const toggleSort = (col) => {
  if(sortBy.value===col) sortOrder.value=sortOrder.value==='asc'?'desc':'asc';
  else { sortBy.value=col; sortOrder.value='asc'; }
};
const applyExt = (ext) => { extFilter.value=extFilter.value===ext?'':ext; };

// ── Index actions ─────────────────────────────────────────────────────────────
const selectIndex = (idx) => {
  activeIndex.value=idx; idxMenuOpen.value=false;
  stats.value=null; audit.value=[]; dupes.value=[]; timeline.value=[];
  results.value=[]; contentResults.value=[]; doSearch(1);
};
const startIndex = async () => {
  if (!newPath.value.trim()) { scanMsg.value='请输入目录路径'; return; }
  isIndexing.value=true; scanProg.value={processed:0,skipped:0,contentDone:0,message:'启动中…',phase:''}; scanMsg.value='';
  try {
    const {data} = await http().post(`${API}/api/index`,{
      directoryPath:newPath.value.trim(), name:newName.value.trim()||undefined,
      includeContent:inclContent.value,
    });
    if(!data.success){scanMsg.value=data.error||'失败';isIndexing.value=false;return;}
    const es=new EventSource(`${API}/api/index/stream?taskId=${data.taskId}`);
    es.onmessage=async(e)=>{
      const ev=JSON.parse(e.data);
      if(ev.type==='ping') return;
      if(ev.type==='progress') scanProg.value={processed:ev.processed||0,skipped:ev.skipped||0,contentDone:ev.contentDone||0,message:ev.message,phase:ev.phase||''};
      else if(ev.type==='done'){
        es.close(); isIndexing.value=false; scanMsg.value=`✓ ${ev.message}`;
        newPath.value=''; newName.value=''; inclContent.value=false;
        await loadIndexes();
        const fresh=indexes.value.find(i=>i.id===ev.indexId);
        if(fresh){selectIndex(fresh);view.value='search';}
      } else if(ev.type==='error'){es.close();isIndexing.value=false;scanMsg.value=`错误：${ev.message}`;}
    };
    es.onerror=()=>{es.close();isIndexing.value=false;scanMsg.value='连接中断';};
  } catch(err){isIndexing.value=false;scanMsg.value=err.response?.data?.error||err.message;}
};
const delIndex = async (idx) => {
  if(!confirm(`删除索引「${idx.name}」？`)) return;
  await http().delete(`${API}/api/indexes/${idx.id}`);
  if(activeIndex.value?.id===idx.id){activeIndex.value=null;results.value=[];contentResults.value=[];}
  await loadIndexes();
};
const confirmRename = async () => {
  if(!renameVal.value.trim()||!renaming.value) return;
  await http().post(`${API}/api/indexes/${renaming.value.id}/rename`,{name:renameVal.value.trim()});
  await loadIndexes();
  if(activeIndex.value?.id===renaming.value.id) activeIndex.value=indexes.value.find(i=>i.id===renaming.value.id);
  renaming.value=null;
};
const exportCsv = () => { if(activeIndex.value) window.open(`${API}/api/export/${activeIndex.value.id}`,'_blank'); };
const exportAudit = () => { if(activeIndex.value) window.open(`${API}/api/audit/${activeIndex.value.id}/export`,'_blank'); };

// ── Settings ──────────────────────────────────────────────────────────────────
const addPat = () => {const p=cfg.value.newPat.trim();if(p&&!cfg.value.ignorePatterns.includes(p)){cfg.value.ignorePatterns.push(p);cfg.value.newPat='';}};
const rmPat  = i => cfg.value.ignorePatterns.splice(i,1);
const saveCfg = async () => {
  try {
    await http().post(`${API}/api/settings`,{ignorePatterns:cfg.value.ignorePatterns,fuzzyThreshold:cfg.value.fuzzyThreshold,apiKey:cfg.value.newKey||undefined});
    if(cfg.value.newKey){apiKey.value=cfg.value.newKey;cfg.value.newKey='';}
    await loadCfg(); cfgMsg.value='✓ 已保存'; setTimeout(()=>cfgMsg.value='',2000);
  } catch(err){cfgMsg.value=`失败：${err.message}`;}
};

// ── Nav ───────────────────────────────────────────────────────────────────────
const goView = async (v) => {
  view.value=v;
  if(v==='stats')     { if(!stats.value) await loadStats(); }
  if(v==='audit')     { await loadAudit(); }
  if(v==='duplicates'){ if(!dupes.value.length) await loadDupes(); }
  if(v==='timeline')  { if(!timeline.value.length) await loadTimeline(); }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (kb) => {const n=Number(kb);if(isNaN(n)||n===0)return'—';if(n>=1024*1024)return(n/1024/1024).toFixed(1)+' GB';if(n>=1024)return(n/1024).toFixed(1)+' MB';return n.toFixed(1)+' KB';};
const sortIcon = col => sortBy.value!==col?'':sortOrder.value==='asc'?'↑':'↓';
const fname = p => (p||'').split(/[\\/]/).pop();
const tokenColor = t => t.type==='size'?'#f59e0b':t.type==='date'?'#34d399':t.type==='ext'?'#60a5fa':'#a78bfa';
const scoreColor = s => s>=90?'#34d399':s>=70?'#f59e0b':'#94a3b8';
const EXT_ICONS = {'.pdf':'📄','.doc':'📝','.docx':'📝','.xls':'📊','.xlsx':'📊','.ppt':'📋','.pptx':'📋','.jpg':'🖼','.jpeg':'🖼','.png':'🖼','.mp4':'🎬','.mp3':'🎵','.zip':'📦','.rar':'📦','.py':'🐍','.js':'⚡','.ts':'⚡','.go':'🔵','.rs':'🦀','.md':'📖','.txt':'📄','.json':'{}','.xml':'</>','.html':'🌐','.csv':'📊','.sql':'🗃','.sh':'💻','.log':'📋'};
const extIcon = ext => EXT_ICONS[ext]||'📄';
const sanitizeSnippet = html => (html||'').replace(/<(?!\/?mark\b)[^>]*>/gi,'');
const actionLabel = a => ({'search':'元数据搜索','content_search':'内容搜索','audit_view':'审计查看','index_view':'预览文件'}[a]||a);
const actionColor = a => a==='content_search'?'#60a5fa':a==='audit_view'?'#f59e0b':'#94a3b8';
</script>

<template>
<div class="app" @click="idxMenuOpen&&(idxMenuOpen=false)">

  <!-- RENAME MODAL -->
  <div v-if="renaming" class="overlay" @click.self="renaming=null">
    <div class="modal">
      <p class="modal-title">重命名索引</p>
      <input v-model="renameVal" class="inp" placeholder="新名称" @keyup.enter="confirmRename" />
      <div class="modal-btns">
        <button class="btn-ghost" @click="renaming=null">取消</button>
        <button class="btn-acc"   @click="confirmRename">确认</button>
      </div>
    </div>
  </div>

  <!-- TOPBAR -->
  <header class="topbar">
    <div class="topbar-l">
      <div class="logo">
        <span class="logo-mark">◈</span>
        <span class="logo-name">FileIndex</span>
        <span class="logo-badge">Enterprise</span>
      </div>
      <div class="idx-sel" @click.stop="idxMenuOpen=!idxMenuOpen">
        <span class="idx-dot" :class="activeIndex?.status==='done'?'green':'amber'"></span>
        <span class="idx-lbl">{{ activeIndex?.name||'选择索引' }}</span>
        <span class="idx-arr">{{ idxMenuOpen?'▲':'▼' }}</span>
        <div v-if="idxMenuOpen" class="idx-menu" @click.stop>
          <div v-for="idx in indexes" :key="idx.id"
               :class="['idx-item',activeIndex?.id===idx.id&&'idx-active']"
               @click="selectIndex(idx)">
            <span class="idx-dot" :class="idx.status==='done'?'green':'amber'"></span>
            <div style="flex:1;min-width:0">
              <div class="idx-name-sm">{{ idx.name }}</div>
              <div class="idx-meta">{{ idx.directory }}</div>
            </div>
            <span v-if="idx.include_content" class="idx-cap-badge">内容</span>
            <span class="idx-cnt-sm">{{ (idx.total_files||0).toLocaleString() }}</span>
            <span class="idx-act" @click.stop="renaming=idx;renameVal=idx.name">✎</span>
            <span class="idx-act danger" @click.stop="delIndex(idx)">✕</span>
          </div>
          <div class="idx-div"></div>
          <div class="idx-item" @click="idxMenuOpen=false;view='index'">
            <span style="color:var(--acc)">＋</span> 新建索引
          </div>
        </div>
      </div>
    </div>

    <nav class="topnav">
      <button :class="['tnav',view==='search'&&'tnav-on']"     @click="view='search'">搜索</button>
      <button :class="['tnav',view==='timeline'&&'tnav-on']"   @click="goView('timeline')"  :disabled="!activeIndex">最近</button>
      <button :class="['tnav',view==='stats'&&'tnav-on']"      @click="goView('stats')"     :disabled="!activeIndex">统计</button>
      <button :class="['tnav',view==='duplicates'&&'tnav-on']" @click="goView('duplicates')" :disabled="!activeIndex">重复</button>
      <button :class="['tnav tnav-audit',view==='audit'&&'tnav-on']" @click="goView('audit')" :disabled="!activeIndex">审计日志</button>
      <button :class="['tnav',view==='index'&&'tnav-on']"      @click="view='index'">索引</button>
      <button :class="['tnav',view==='settings'&&'tnav-on']"   @click="view='settings'">⚙</button>
    </nav>

    <div class="topbar-r">
      <span v-if="sysInfo.pinyinAvailable" class="sys-badge">拼音</span>
      <span v-if="caps.pdf||caps.docx||caps.xlsx" class="sys-badge" style="color:var(--acc)">内容提取</span>
      <button v-if="activeIndex" class="btn-sm" @click="exportCsv">↓ CSV</button>
    </div>
  </header>

  <!-- ── SEARCH VIEW ──────────────────────────────────────────────────────────── -->
  <div v-if="view==='search'" class="body-wrap">
    <div class="searchbar-wrap">

      <!-- Search bar -->
      <div :class="['searchbar', isSearch&&'sb-busy', contentMode&&'sb-content']">
        <span class="sb-icon">{{ contentMode?'❝':'⌕' }}</span>
        <input ref="searchRef" v-model="query" class="sb-input"
               :placeholder="contentMode?'在文件内容中搜索…（支持 PDF / Word / 代码 / Excel）'
               :nlqMode?'自然语言：找上周修改的大于5MB的PDF…':'搜索文件名、路径或创建者…'" />
        <button v-if="query" class="sb-clear" @click="query=''">✕</button>
        <div class="sb-pills">
          <button :class="['pill',contentMode&&'pill-on pill-content']"
                  @click="contentMode=!contentMode;nlqMode=false"
                  :title="caps.pdf||caps.docx||caps.xlsx?'内容搜索（搜索文件内部）':'需要安装 pypdf / python-docx / openpyxl'">
            内容
          </button>
          <button v-if="!contentMode" :class="['pill',nlqMode&&'pill-on']" @click="nlqMode=!nlqMode" title="自然语言模式">NL</button>
          <button v-if="!contentMode" :class="['pill',fuzzyMode&&'pill-on']" @click="fuzzyMode=!fuzzyMode" title="模糊搜索">≈</button>
        </div>
        <button class="btn-acc sb-btn" :disabled="isSearch||!activeIndex" @click="doSearch(1)">
          {{ isSearch?'…':'搜索' }}
        </button>
      </div>

      <!-- Content mode banner -->
      <div v-if="contentMode" class="content-banner">
        <span class="cb-icon">❝</span>
        <div>
          <span class="cb-title">内容全文搜索</span>
          <span class="cb-desc">搜索文件内部文字，支持 PDF、Word、Excel、代码等 50+ 种格式。这是系统搜索和 Spotlight 做不到的。</span>
        </div>
        <div class="cb-caps">
          <span :class="['cb-cap',caps.pdf&&'cap-on']">PDF {{ caps.pdf?'✓':'✗' }}</span>
          <span :class="['cb-cap',caps.docx&&'cap-on']">Word {{ caps.docx?'✓':'✗' }}</span>
          <span :class="['cb-cap',caps.xlsx&&'cap-on']">Excel {{ caps.xlsx?'✓':'✗' }}</span>
          <span class="cb-cap cap-on">代码 ✓</span>
        </div>
      </div>

      <!-- NLQ tokens -->
      <div v-if="tokens.length&&!contentMode" class="tokens-row">
        <span v-for="t in tokens" :key="t.label" class="token"
              :style="{background:tokenColor(t)+'18',color:tokenColor(t),borderColor:tokenColor(t)+'40'}">
          {{ t.label }}
        </span>
        <span class="token-hint">自然语言已解析</span>
      </div>

      <!-- Ext chips -->
      <div v-if="extStats.length&&!contentMode" class="chips-row">
        <button :class="['chip',!extFilter&&'chip-on']" @click="applyExt('')">全部 {{ total.toLocaleString() }}</button>
        <button v-for="[ext,cnt] in extStats.slice(0,12)" :key="ext"
                :class="['chip',extFilter===ext&&'chip-on']" @click="applyExt(ext)">
          {{ extIcon(ext) }} {{ ext }} <span class="chip-n">{{ cnt.toLocaleString() }}</span>
        </button>
      </div>

      <!-- History -->
      <div v-if="!query&&history.length" class="hist-row">
        <span class="hist-lbl">最近</span>
        <button v-for="h in history" :key="h" class="hist-chip" @click="query=h">{{ h }}</button>
        <button class="hist-clear" @click="history=[]">清除</button>
      </div>
    </div>

    <!-- Split pane -->
    <div class="split-pane" v-if="(contentMode?contentResults:results).length || searchDone || contentDone">
      <!-- Result list -->
      <div class="result-panel">
        <div class="rp-head">
          <span class="rp-count">
            <template v-if="contentMode">
              {{ contentTotal.toLocaleString() }} 个文件内含此内容
              <span class="dim" style="font-size:10px"> · {{ contentDurMs }}ms</span>
            </template>
            <template v-else>
              {{ total.toLocaleString() }} 个文件
              <span class="dim" style="font-size:10px"> · {{ durMs }}ms</span>
            </template>
          </span>
          <div v-if="!contentMode" class="rp-sort">
            <span class="sort-btn" @click="toggleSort('name')">名称{{ sortIcon('name') }}</span>
            <span class="sort-btn" @click="toggleSort('size')">大小{{ sortIcon('size') }}</span>
            <span class="sort-btn" @click="toggleSort('modifiedTime')">时间{{ sortIcon('modifiedTime') }}</span>
          </div>
        </div>

        <!-- Content search error -->
        <div v-if="contentMode&&contentError" class="content-err">
          <span style="font-size:16px">⚠</span>
          <div>
            <div style="font-size:13px;font-weight:500;margin-bottom:4px">{{ contentError }}</div>
            <div style="font-size:11px;color:var(--tx2)">创建索引时请勾选「提取文件内容」，或安装缺失的依赖包。</div>
            <button class="btn-sm" style="margin-top:8px" @click="view='index'">前往创建索引 →</button>
          </div>
        </div>

        <!-- Content results -->
        <div v-else-if="contentMode" class="result-list">
          <div v-for="(r,i) in contentResults" :key="i" :id="`row-${i}`"
               :class="['result-row',selIdx===i&&'row-sel']"
               @click="selIdx=i;fetchPreview(r)">
            <span class="r-icon">{{ extIcon(r.ext) }}</span>
            <div class="r-info">
              <div class="r-name">{{ r.name }}</div>
              <!-- snippet with highlight -->
              <div class="r-snippet" v-html="sanitizeSnippet(r.snippet)"></div>
              <div class="r-path">{{ r.path }}</div>
            </div>
            <div class="r-meta">
              <span class="r-size">{{ fmt(r.size) }}</span>
            </div>
          </div>
          <div v-if="contentTotalPgs>1" class="pagination">
            <button class="pg-btn" :disabled="contentPg===1" @click="doContentSearch(1)">«</button>
            <button class="pg-btn" :disabled="contentPg===1" @click="doContentSearch(contentPg-1)">‹</button>
            <span class="pg-info">{{ contentPg }}/{{ contentTotalPgs }}</span>
            <button class="pg-btn" :disabled="contentPg===contentTotalPgs" @click="doContentSearch(contentPg+1)">›</button>
            <button class="pg-btn" :disabled="contentPg===contentTotalPgs" @click="doContentSearch(contentTotalPgs)">»</button>
          </div>
        </div>

        <!-- Meta results -->
        <div v-else class="result-list">
          <div v-for="(r,i) in results" :key="i" :id="`row-${i}`"
               :class="['result-row',selIdx===i&&'row-sel']"
               @click="selIdx=i;fetchPreview(r)">
            <span class="r-icon">{{ extIcon(r.ext) }}</span>
            <div class="r-info">
              <div class="r-name">{{ r.name||fname(r.path) }}</div>
              <div class="r-path">{{ r.path }}</div>
            </div>
            <div class="r-meta">
              <span class="r-size">{{ fmt(r.size) }}</span>
              <span v-if="fuzzyMode&&r.score!=null" class="r-score" :style="{color:scoreColor(r.score)}">{{ r.score }}%</span>
            </div>
          </div>
          <div v-if="totalPgs>1" class="pagination">
            <button class="pg-btn" :disabled="page===1" @click="doSearch(1)">«</button>
            <button class="pg-btn" :disabled="page===1" @click="doSearch(page-1)">‹</button>
            <span class="pg-info">{{ page }}/{{ totalPgs }}</span>
            <button class="pg-btn" :disabled="page===totalPgs" @click="doSearch(page+1)">›</button>
            <button class="pg-btn" :disabled="page===totalPgs" @click="doSearch(totalPgs)">»</button>
          </div>
        </div>
      </div>

      <!-- Preview panel -->
      <div class="preview-panel">
        <div v-if="prevLoading" class="pv-empty"><span style="font-size:18px;color:var(--tx3)">…</span></div>
        <div v-else-if="preview" class="pv-content">
          <div class="pv-head">
            <span class="pv-icon">{{ extIcon(preview.ext) }}</span>
            <div>
              <div class="pv-name">{{ preview.name }}</div>
              <div class="pv-path">{{ preview.path }}</div>
            </div>
          </div>
          <div class="pv-meta-grid">
            <div class="pv-mi"><span class="pv-ml">大小</span><span class="pv-mv">{{ fmt(preview.size_kb) }}</span></div>
            <div class="pv-mi"><span class="pv-ml">修改时间</span><span class="pv-mv">{{ preview.modified }}</span></div>
            <div class="pv-mi"><span class="pv-ml">类型</span><span class="pv-mv">{{ preview.ext }}</span></div>
            <div v-if="preview.encoding" class="pv-mi"><span class="pv-ml">编码</span><span class="pv-mv">{{ preview.encoding }}</span></div>
          </div>
          <!-- Content snippet from search -->
          <div v-if="preview.snippet" class="pv-snippet-wrap">
            <div class="pv-code-hd"><span>匹配内容</span></div>
            <div class="pv-snippet" v-html="sanitizeSnippet(preview.snippet)"></div>
          </div>
          <!-- File preview -->
          <div v-if="preview.content!=null" class="pv-code-wrap">
            <div class="pv-code-hd"><span>文件预览</span><span class="pv-lines">前 {{ preview.lines }} 行</span></div>
            <pre class="pv-code">{{ preview.content }}</pre>
          </div>
          <div v-else-if="!preview.snippet" class="pv-no-prev">
            <span style="font-size:28px">{{ extIcon(preview.ext) }}</span>
            <p>该文件类型不支持预览</p>
            <p v-if="!activeIndex?.include_content" style="font-size:11px;margin-top:4px">
              创建索引时勾选「提取文件内容」可启用 PDF/Word 内容搜索
            </p>
          </div>
        </div>
        <div v-else class="pv-empty">
          <div style="font-size:28px;color:var(--tx3)">{{ contentMode?'❝':'⌕' }}</div>
          <p>选择文件查看详情</p>
          <p class="pv-hint">↑↓ 键切换</p>
        </div>
      </div>
    </div>

    <!-- Empty / hero states -->
    <div v-if="!activeIndex" class="empty-hero">
      <div class="eh-icon">◈</div>
      <h2 class="eh-title">本地文件智能搜索</h2>
      <p class="eh-sub">索引本地文件，在文件名和文件内容中闪电搜索</p>
      <div class="feature-grid">
        <div class="feat"><span class="feat-icon">❝</span><div><div class="feat-t">内容全文搜索</div><div class="feat-d">搜索 PDF、Word、代码内部文字，Spotlight 做不到</div></div></div>
        <div class="feat"><span class="feat-icon">🌐</span><div><div class="feat-t">自然语言查询</div><div class="feat-d">「上周修改的大于5MB的PDF」直接搜索</div></div></div>
        <div class="feat"><span class="feat-icon">🔐</span><div><div class="feat-t">企业审计日志</div><div class="feat-d">记录所有搜索行为，满足合规要求</div></div></div>
        <div class="feat"><span class="feat-icon">🏠</span><div><div class="feat-t">数据不出本机</div><div class="feat-d">零云端依赖，满足数据主权要求</div></div></div>
      </div>
      <button class="btn-acc" @click="view='index'" style="margin-top:1.5rem">创建第一个索引 →</button>
    </div>

    <div v-else-if="(contentMode?contentDone:searchDone) && !(contentMode?contentResults:results).length && !contentError" class="empty-hero" style="padding-top:3rem">
      <div style="font-size:2rem;color:var(--tx3)">∅</div>
      <p style="font-size:13px;color:var(--tx2)">没有找到匹配的文件</p>
      <p v-if="!fuzzyMode&&!contentMode" style="font-size:11px;color:var(--tx3);margin-top:4px">开启模糊搜索（≈）可容忍拼写错误</p>
    </div>

    <div v-else-if="!query&&!(contentMode?contentResults:results).length&&activeIndex" class="samples">
      <p class="samples-title">尝试这些搜索</p>
      <div class="samples-grid">
        <div class="sample" @click="query='大于50MB的视频'">大于50MB的视频</div>
        <div class="sample" @click="query='上周修改的PDF'">上周修改的PDF</div>
        <div class="sample" @click="query='今年的Excel表格'">今年的Excel表格</div>
        <div class="sample" @click="query='python files last month'">python files last month</div>
        <div class="sample sample-content" @click="contentMode=true;query='合同'">❝ 在内容中搜索「合同」</div>
        <div class="sample sample-content" @click="contentMode=true;query='TODO'">❝ 在代码中搜索「TODO」</div>
      </div>
    </div>
  </div>

  <!-- ── INDEX VIEW ────────────────────────────────────────────────────────── -->
  <div v-if="view==='index'" class="body-wrap body-padded">
    <div class="page-title">新建索引</div>
    <div class="card">
      <div class="field-row">
        <div class="fg" style="flex:2">
          <label class="fl">目录路径</label>
          <input v-model="newPath" class="inp" placeholder="/path  或  C:\path" :disabled="isIndexing" @keyup.enter="startIndex" />
        </div>
        <div class="fg">
          <label class="fl">索引名称（可选）</label>
          <input v-model="newName" class="inp" placeholder="自动使用文件夹名" :disabled="isIndexing" />
        </div>
      </div>

      <!-- Content extraction toggle -->
      <div class="content-toggle" :class="inclContent&&'ct-on'" @click="inclContent=!inclContent">
        <div class="ct-dot"></div>
        <div>
          <div class="ct-title">提取文件内容 <span class="ct-tag">核心差异化功能</span></div>
          <div class="ct-desc">
            索引时读取文件内部文字（PDF / Word / Excel / 代码 / 纯文本），支持在内容中搜索。
            扫描时间会增加，但解锁「内容全文搜索」功能。
            <span class="ct-caps">
              PDF {{ caps.pdf?'✓':'需安装 pypdf' }} ·
              Word {{ caps.docx?'✓':'需安装 python-docx' }} ·
              Excel {{ caps.xlsx?'✓':'需安装 openpyxl' }}
            </span>
          </div>
        </div>
      </div>

      <button class="btn-acc" :disabled="isIndexing" @click="startIndex" style="margin-top:14px">
        <span v-if="!isIndexing">开始扫描</span>
        <span v-else class="pulse">{{ scanProg.phase==='content'?'提取内容…':'扫描中…' }}</span>
      </button>

      <div v-if="isIndexing" class="prog-wrap">
        <div class="prog-meta">
          <span class="prog-msg">{{ scanProg.message }}</span>
          <span class="prog-n" :style="scanProg.phase==='content'?{color:'var(--acc)'}:{}">
            {{ scanProg.phase==='content'
               ? `已提取 ${(scanProg.contentDone||0).toLocaleString()} 份内容`
               : `${scanProg.processed.toLocaleString()} 个文件` }}
          </span>
        </div>
        <div class="prog-bar"><div class="prog-fill scan-anim"></div></div>
        <div v-if="scanProg.skipped>0" class="prog-skip">跳过 {{ scanProg.skipped.toLocaleString() }} 个</div>
      </div>
      <div v-if="scanMsg" :class="['scan-msg',scanMsg.startsWith('✓')?'ok':'info']">{{ scanMsg }}</div>
    </div>

    <div class="page-title" style="margin-top:28px">已建立的索引</div>
    <div class="card">
      <div v-if="!indexes.length" style="font-size:13px;color:var(--tx2)">暂无索引</div>
      <table v-else class="idx-table">
        <thead><tr><th>名称</th><th>目录</th><th>文件数</th><th>内容</th><th>时间</th><th>状态</th><th></th></tr></thead>
        <tbody>
          <tr v-for="idx in indexes" :key="idx.id" :class="activeIndex?.id===idx.id&&'tr-active'" @click="selectIndex(idx)">
            <td class="td-name">{{ idx.name }}</td>
            <td class="td-dir">{{ idx.directory }}</td>
            <td class="mono">{{ (idx.total_files||0).toLocaleString() }}</td>
            <td class="mono">{{ idx.include_content?(idx.content_files||0).toLocaleString():'—' }}</td>
            <td class="mono dim">{{ idx.created_at }}</td>
            <td><span :class="['chip-st',idx.status==='done'?'green':'amber']">{{ idx.status==='done'?'就绪':'扫描中' }}</span></td>
            <td class="td-act" @click.stop>
              <button class="act-btn" @click.stop="renaming=idx;renameVal=idx.name">✎</button>
              <button class="act-btn danger" @click.stop="delIndex(idx)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ── TIMELINE VIEW ─────────────────────────────────────────────────────── -->
  <div v-if="view==='timeline'" class="body-wrap body-padded">
    <div class="page-title">最近修改 <span class="dim" style="font-size:13px">— 过去 14 天</span></div>
    <div v-if="!timeline.length" class="empty-sm">暂无数据</div>
    <div v-else class="tl-list">
      <div v-for="(f,i) in timeline" :key="i" class="tl-row">
        <span class="tl-icon">{{ extIcon(f.ext) }}</span>
        <div class="tl-info"><div class="tl-name">{{ f.name }}</div><div class="tl-path">{{ f.path }}</div></div>
        <div class="tl-right"><div class="tl-size">{{ fmt(f.size_kb) }}</div><div class="tl-time">{{ f.modified_time }}</div></div>
      </div>
    </div>
  </div>

  <!-- ── STATS VIEW ────────────────────────────────────────────────────────── -->
  <div v-if="view==='stats'" class="body-wrap body-padded">
    <div class="page-title">统计分析</div>
    <div v-if="!stats" style="text-align:center;padding:32px"><button class="btn-acc" @click="loadStats">加载统计</button></div>
    <div v-else>
      <div class="stat-cards">
        <div class="stat-c"><div class="stat-n">{{ (stats.totalFiles||0).toLocaleString() }}</div><div class="stat-l">总文件数</div></div>
        <div class="stat-c"><div class="stat-n">{{ fmt(stats.totalSizeKB) }}</div><div class="stat-l">总空间</div></div>
        <div class="stat-c" :class="stats.contentFiles&&'stat-highlight'">
          <div class="stat-n" :style="stats.contentFiles?{color:'var(--acc)'}:{}">{{ (stats.contentFiles||0).toLocaleString() }}</div>
          <div class="stat-l">已提取内容</div>
        </div>
      </div>
      <!-- Timeline bar chart -->
      <div v-if="stats.timeline?.length" class="card" style="margin-bottom:16px">
        <div class="card-title">近 30 天修改活动</div>
        <div class="chart-wrap">
          <div v-for="[day,cnt] in stats.timeline" :key="day" class="chart-bw" :title="`${day}: ${cnt}`">
            <div class="chart-b" :style="{height:(cnt/Math.max(...stats.timeline.map(r=>r[1]))*100)+'%'}"></div>
            <div class="chart-l">{{ day.slice(5) }}</div>
          </div>
        </div>
      </div>
      <!-- Top queries -->
      <div v-if="stats.topQueries?.length" class="card" style="margin-bottom:16px">
        <div class="card-title">热门搜索词</div>
        <div class="query-list">
          <div v-for="[q,cnt] in stats.topQueries" :key="q" class="query-row">
            <span class="query-term" @click="view='search';query=q" style="cursor:pointer">{{ q||'（空白）' }}</span>
            <span class="query-cnt mono">{{ cnt }}</span>
          </div>
        </div>
      </div>
      <div class="two-col">
        <div class="card">
          <div class="card-title">文件类型分布</div>
          <div class="ext-bars">
            <div v-for="[ext,cnt] in stats.topExtensions" :key="ext" class="eb-row"
                 @click="extFilter=ext;view='search';doSearch(1)" style="cursor:pointer">
              <span class="eb-icon">{{ extIcon(ext) }}</span>
              <span class="eb-ext">{{ ext }}</span>
              <div class="eb-track"><div class="eb-fill" :style="{width:(cnt/stats.topExtensions[0][1]*100)+'%'}"></div></div>
              <span class="eb-cnt mono">{{ cnt.toLocaleString() }}</span>
            </div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="card">
            <div class="card-title">创建者排行</div>
            <div v-for="([cr,cnt],i) in stats.topCreators" :key="cr" class="cr-row">
              <span class="cr-rank">{{ i+1 }}</span>
              <span class="cr-name">{{ cr }}</span>
              <span class="cr-cnt mono">{{ cnt.toLocaleString() }}</span>
            </div>
          </div>
          <div class="card">
            <div class="card-title">最大文件</div>
            <div v-for="f in stats.largestFiles" :key="f.path" class="lf-row">
              <span class="lf-icon">{{ extIcon('.'+f.name?.split('.').pop()) }}</span>
              <span class="lf-name" :title="f.path">{{ f.name||fname(f.path) }}</span>
              <span class="lf-size mono">{{ fmt(f.size) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ── AUDIT VIEW ────────────────────────────────────────────────────────── -->
  <div v-if="view==='audit'" class="body-wrap body-padded">
    <div class="audit-header">
      <div class="page-title">审计日志 <span class="dim" style="font-size:13px">— 共 {{ auditTotal.toLocaleString() }} 条</span></div>
      <div class="audit-tools">
        <select v-model="auditFilter" class="audit-select" @change="loadAudit()">
          <option value="">全部操作</option>
          <option value="search">元数据搜索</option>
          <option value="content_search">内容搜索</option>
          <option value="audit_view">审计查看</option>
        </select>
        <button class="btn-sm" @click="exportAudit">↓ 导出 CSV</button>
      </div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <table class="audit-table">
        <thead><tr><th>时间</th><th>操作</th><th>搜索词</th><th>结果数</th><th>耗时</th><th>IP</th></tr></thead>
        <tbody>
          <tr v-for="log in audit" :key="log.id">
            <td class="mono dim">{{ log.timestamp }}</td>
            <td><span class="action-chip" :style="{color:actionColor(log.action),background:actionColor(log.action)+'18'}">{{ actionLabel(log.action) }}</span></td>
            <td class="audit-query">{{ log.query||'—' }}</td>
            <td class="mono">{{ log.result_count??'—' }}</td>
            <td class="mono dim">{{ log.duration_ms!=null?log.duration_ms+'ms':'—' }}</td>
            <td class="mono dim">{{ log.ip||'—' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!audit.length" class="empty-sm" style="padding:20px">暂无记录</div>
    </div>
  </div>

  <!-- ── DUPLICATES VIEW ───────────────────────────────────────────────────── -->
  <div v-if="view==='duplicates'" class="body-wrap body-padded">
    <div class="page-title">重复文件</div>
    <div v-if="!dupes.length" class="empty-sm">未检测到重复文件</div>
    <div v-else class="dupe-list">
      <div v-for="(g,i) in dupes" :key="i" class="dupe-group">
        <div class="dupe-head">
          <span>{{ extIcon('.'+g.name.split('.').pop()) }}</span>
          <span class="dupe-name">{{ g.name }}</span>
          <span class="dupe-size mono">{{ fmt(g.size_kb) }}</span>
          <span class="dupe-cnt">× {{ g.count }}</span>
        </div>
        <div v-for="p in g.paths" :key="p" class="dupe-path">{{ p }}</div>
      </div>
    </div>
  </div>

  <!-- ── SETTINGS VIEW ─────────────────────────────────────────────────────── -->
  <div v-if="view==='settings'" class="body-wrap body-padded">
    <div class="page-title">设置</div>
    <div class="card">
      <div class="card-title">忽略规则 <span class="dim">（glob 格式）</span></div>
      <div class="pat-list">
        <div v-for="(p,i) in cfg.ignorePatterns" :key="i" class="pat-item">
          <span class="pat-txt mono">{{ p }}</span>
          <button class="act-btn danger" @click="rmPat(i)">✕</button>
        </div>
      </div>
      <div class="pat-add">
        <input v-model="cfg.newPat" class="inp" placeholder="*.tmp  或  node_modules" @keyup.enter="addPat" style="flex:1" />
        <button class="btn-ghost" @click="addPat">添加</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">内容提取能力</div>
      <div class="caps-grid">
        <div class="cap-item" :class="caps.pdf&&'cap-ready'">
          <span style="font-size:18px">📄</span>
          <div><div class="cap-name">PDF</div><div class="cap-status">{{ caps.pdf?'已就绪':'pip install pypdf' }}</div></div>
        </div>
        <div class="cap-item" :class="caps.docx&&'cap-ready'">
          <span style="font-size:18px">📝</span>
          <div><div class="cap-name">Word (.docx)</div><div class="cap-status">{{ caps.docx?'已就绪':'pip install python-docx' }}</div></div>
        </div>
        <div class="cap-item" :class="caps.xlsx&&'cap-ready'">
          <span style="font-size:18px">📊</span>
          <div><div class="cap-name">Excel (.xlsx)</div><div class="cap-status">{{ caps.xlsx?'已就绪':'pip install openpyxl' }}</div></div>
        </div>
        <div class="cap-item cap-ready">
          <span style="font-size:18px">🐍</span>
          <div><div class="cap-name">代码 / 文本</div><div class="cap-status">已就绪（内置）</div></div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">模糊搜索阈值：{{ cfg.fuzzyThreshold }}%</div>
      <input type="range" min="20" max="95" step="5" v-model.number="cfg.fuzzyThreshold" class="slider" />
      <div class="slider-ends"><span>宽松</span><span>严格</span></div>
      <p class="card-sub">引擎：<span class="mono">{{ sysInfo.fuzzyEngine||'—' }}</span>
        <span v-if="sysInfo.pinyinAvailable" class="sys-badge" style="margin-left:8px">拼音 ✓</span></p>
    </div>
    <div class="card">
      <div class="card-title">API Key 认证</div>
      <p class="card-sub">当前：<strong>{{ cfg.apiKeyEnabled?'已启用':'未启用' }}</strong></p>
      <input v-model="cfg.newKey" type="password" class="inp" placeholder="输入新 Key（留空保持不变）" autocomplete="new-password" />
    </div>
    <div style="display:flex;align-items:center;gap:12px;padding:4px 0">
      <button class="btn-acc" @click="saveCfg">保存设置</button>
      <span v-if="cfgMsg" :class="['scan-msg',cfgMsg.startsWith('✓')?'ok':'info']" style="display:inline-block">{{ cfgMsg }}</span>
    </div>
  </div>

  <!-- Keyboard hints -->
  <div class="kbd-hints">
    <span class="kbd">/</span><span class="kl">搜索</span>
    <span class="kbd">↑↓</span><span class="kl">切换</span>
    <span class="kbd">Esc</span><span class="kl">清空</span>
  </div>

</div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d0d0d;--s1:#141414;--s2:#1a1a1a;--s3:#222;--s4:#2a2a2a;
  --bd:rgba(255,255,255,.07);--bd2:rgba(255,255,255,.12);--bd3:rgba(255,255,255,.18);
  --acc:#ff6200;--acc2:#ff7a28;--acc3:rgba(255,98,0,.12);
  --green:#34d399;--amber:#f59e0b;--red:#f87171;--blue:#60a5fa;
  --tx:#f0f0f0;--tx2:#888;--tx3:#555;
  --mono:'JetBrains Mono',monospace;--ui:'Inter',sans-serif;--r:8px;
}
body{font-family:var(--ui);background:var(--bg);color:var(--tx);min-height:100vh;font-size:14px;line-height:1.5}
/* ── TOPBAR ── */
.topbar{display:flex;align-items:center;gap:16px;padding:0 18px;height:52px;background:var(--s1);border-bottom:1px solid var(--bd);position:sticky;top:0;z-index:50}
.topbar-l{display:flex;align-items:center;gap:12px}
.logo{display:flex;align-items:center;gap:7px}
.logo-mark{font-size:16px;color:var(--acc)}
.logo-name{font-size:15px;font-weight:600;color:var(--tx);letter-spacing:-0.3px}
.logo-badge{padding:2px 6px;background:var(--acc3);color:var(--acc);border:1px solid rgba(255,98,0,.3);border-radius:4px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
.idx-sel{display:flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--bd2);border-radius:6px;cursor:pointer;position:relative;user-select:none;transition:border-color .15s}
.idx-sel:hover{border-color:var(--bd3)}
.idx-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.idx-dot.green{background:var(--green);box-shadow:0 0 5px var(--green)}
.idx-dot.amber{background:var(--amber)}
.idx-lbl{font-size:12px;color:var(--tx);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.idx-arr{font-size:9px;color:var(--tx2)}
.idx-menu{position:absolute;top:calc(100%+6px);left:0;min-width:360px;background:var(--s2);border:1px solid var(--bd2);border-radius:10px;padding:6px;z-index:200;box-shadow:0 16px 48px rgba(0,0,0,.8)}
.idx-item{display:flex;align-items:center;gap:7px;padding:8px 10px;border-radius:6px;cursor:pointer;transition:background .1s}
.idx-item:hover{background:var(--s3)}
.idx-active{background:var(--acc3)}
.idx-name-sm{font-size:12px;font-weight:500;color:var(--tx)}
.idx-meta{font-size:10px;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
.idx-cap-badge{padding:1px 5px;background:var(--acc3);color:var(--acc);border-radius:3px;font-size:9px}
.idx-cnt-sm{font-size:10px;color:var(--tx2);font-family:var(--mono);white-space:nowrap}
.idx-act{font-size:11px;padding:3px 5px;border-radius:4px;color:var(--tx2);cursor:pointer;transition:all .1s}
.idx-act:hover{background:var(--s4);color:var(--tx)}
.idx-act.danger:hover{color:var(--red)}
.idx-div{height:1px;background:var(--bd);margin:4px 0}
.topnav{display:flex;gap:2px;flex:1;justify-content:center}
.tnav{padding:5px 10px;border:none;border-radius:6px;background:transparent;color:var(--tx2);font-family:var(--ui);font-size:12px;cursor:pointer;transition:all .15s;white-space:nowrap}
.tnav:hover{background:var(--s3);color:var(--tx)}
.tnav-on{background:var(--s3);color:var(--tx);font-weight:500}
.tnav-audit{color:var(--amber)}
.tnav-audit.tnav-on{background:rgba(245,158,11,.1);color:var(--amber)}
.tnav:disabled{opacity:.3;cursor:not-allowed}
.topbar-r{display:flex;align-items:center;gap:7px;margin-left:auto}
.sys-badge{padding:2px 7px;background:var(--s3);border:1px solid var(--bd2);border-radius:10px;font-size:10px;color:var(--tx2);font-family:var(--mono)}
.btn-sm{padding:5px 10px;border:1px solid var(--bd2);border-radius:6px;background:transparent;color:var(--tx2);font-size:11px;cursor:pointer;transition:all .15s;white-space:nowrap}
.btn-sm:hover{border-color:var(--acc);color:var(--acc)}
/* ── BODY ── */
.body-wrap{display:flex;flex-direction:column;height:calc(100vh - 52px);overflow:hidden}
.body-padded{padding:28px 32px;overflow-y:auto}
/* ── SEARCHBAR ── */
.searchbar-wrap{padding:18px 22px 0;flex-shrink:0}
.searchbar{display:flex;align-items:center;gap:8px;background:var(--s2);border:1px solid var(--bd2);border-radius:12px;padding:0 12px;transition:border-color .2s}
.searchbar:focus-within{border-color:rgba(255,98,0,.4)}
.searchbar.sb-busy{border-color:rgba(255,98,0,.25)}
.searchbar.sb-content{border-color:rgba(96,165,250,.4)}
.searchbar.sb-content:focus-within{border-color:rgba(96,165,250,.7)}
.sb-icon{font-size:16px;color:var(--tx2);flex-shrink:0}
.sb-input{flex:1;padding:13px 4px;background:transparent;border:none;color:var(--tx);font-size:14px;font-family:var(--ui);outline:none}
.sb-input::placeholder{color:var(--tx3)}
.sb-clear{border:none;background:transparent;color:var(--tx2);font-size:13px;cursor:pointer;padding:4px;border-radius:4px}
.sb-pills{display:flex;gap:5px;flex-shrink:0}
.pill{padding:4px 9px;border:1px solid var(--bd2);border-radius:16px;background:transparent;color:var(--tx2);font-size:11px;cursor:pointer;transition:all .15s;font-family:var(--mono)}
.pill:hover{border-color:var(--acc);color:var(--acc)}
.pill-on{border-color:var(--acc);color:var(--acc);background:var(--acc3)}
.pill-content.pill-on{border-color:var(--blue);color:var(--blue);background:rgba(96,165,250,.1)}
.btn-acc{padding:8px 18px;border:none;border-radius:7px;background:var(--acc);color:#fff;font-family:var(--ui);font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;white-space:nowrap}
.btn-acc:hover:not(:disabled){background:var(--acc2)}
.btn-acc:disabled{opacity:.5;cursor:not-allowed}
.sb-btn{margin:6px 0}
/* content banner */
.content-banner{display:flex;align-items:flex-start;gap:10px;margin-top:10px;padding:10px 14px;background:rgba(96,165,250,.07);border:1px solid rgba(96,165,250,.2);border-radius:8px}
.cb-icon{font-size:18px;flex-shrink:0;margin-top:1px}
.cb-title{font-size:13px;font-weight:500;color:var(--blue);margin-right:8px}
.cb-desc{font-size:11px;color:var(--tx2)}
.cb-caps{display:flex;gap:8px;margin-top:6px;flex-shrink:0}
.cb-cap{font-size:10px;color:var(--tx3);font-family:var(--mono);padding:2px 7px;background:var(--s3);border-radius:4px;white-space:nowrap}
.cb-cap.cap-on{color:var(--green);background:rgba(52,211,153,.1)}
/* tokens, chips, history */
.tokens-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px}
.token{padding:3px 8px;border-radius:5px;font-size:11px;font-weight:500;border:1px solid transparent;font-family:var(--mono)}
.token-hint{font-size:10px;color:var(--tx3)}
.chips-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chip{padding:3px 9px;border:1px solid var(--bd);border-radius:14px;background:transparent;color:var(--tx2);font-size:11px;cursor:pointer;transition:all .12s;font-family:var(--mono)}
.chip:hover,.chip-on{border-color:var(--acc);color:var(--acc);background:var(--acc3)}
.chip-n{color:var(--tx3);margin-left:3px}
.hist-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px}
.hist-lbl{font-size:10px;color:var(--tx3)}
.hist-chip{padding:3px 9px;border:1px solid var(--bd);border-radius:12px;background:transparent;color:var(--tx2);font-size:11px;cursor:pointer;transition:all .12s}
.hist-chip:hover{border-color:var(--bd2);color:var(--tx)}
.hist-clear{padding:2px 7px;border:none;background:transparent;color:var(--tx3);font-size:11px;cursor:pointer}
.hist-clear:hover{color:var(--red)}
/* ── SPLIT PANE ── */
.split-pane{display:flex;flex:1;overflow:hidden;margin-top:12px;border-top:1px solid var(--bd)}
.result-panel{width:42%;flex-shrink:0;display:flex;flex-direction:column;border-right:1px solid var(--bd);overflow:hidden}
.rp-head{display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-bottom:1px solid var(--bd);flex-shrink:0}
.rp-count{font-size:11px;color:var(--tx2)}
.rp-sort{display:flex;gap:10px}
.sort-btn{font-size:11px;color:var(--tx2);cursor:pointer;user-select:none;transition:color .1s}
.sort-btn:hover{color:var(--tx)}
.result-list{flex:1;overflow-y:auto}
.result-row{display:flex;align-items:flex-start;gap:9px;padding:9px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.04);transition:background .1s}
.result-row:hover{background:var(--s2)}
.row-sel{background:var(--s2)!important;border-right:2px solid var(--acc)}
.r-icon{font-size:18px;width:22px;text-align:center;flex-shrink:0;margin-top:1px}
.r-info{flex:1;min-width:0}
.r-name{font-size:13px;font-weight:500;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.r-path{font-size:10px;color:var(--tx2);font-family:var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.r-snippet{font-size:11px;color:var(--tx2);line-height:1.5;margin:3px 0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.r-snippet mark{background:rgba(255,98,0,.25);color:var(--acc);border-radius:2px;padding:0 2px;font-style:normal}
.r-meta{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0}
.r-size{font-size:10px;color:var(--tx2);font-family:var(--mono)}
.r-score{font-size:10px;font-family:var(--mono)}
.content-err{display:flex;align-items:flex-start;gap:12px;padding:16px;color:var(--amber);background:rgba(245,158,11,.07);border-bottom:1px solid var(--bd)}
/* ── PREVIEW ── */
.preview-panel{flex:1;overflow-y:auto;background:var(--s1)}
.pv-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:var(--tx2)}
.pv-hint{font-size:11px;color:var(--tx3)}
.pv-content{padding:18px}
.pv-head{display:flex;align-items:flex-start;gap:10px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--bd)}
.pv-icon{font-size:26px}
.pv-name{font-size:14px;font-weight:600;color:var(--tx);word-break:break-all}
.pv-path{font-size:10px;color:var(--tx2);font-family:var(--mono);margin-top:3px;word-break:break-all}
.pv-meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}
.pv-mi{display:flex;flex-direction:column;gap:2px;padding:9px;background:var(--s2);border-radius:6px}
.pv-ml{font-size:9px;color:var(--tx2);text-transform:uppercase;letter-spacing:.06em}
.pv-mv{font-size:12px;color:var(--tx);font-family:var(--mono)}
.pv-snippet-wrap,.pv-code-wrap{border:1px solid var(--bd);border-radius:8px;overflow:hidden;margin-bottom:12px}
.pv-code-hd{display:flex;justify-content:space-between;padding:7px 11px;background:var(--s3);font-size:10px;color:var(--tx2)}
.pv-lines{font-family:var(--mono)}
.pv-snippet{padding:12px;font-size:12px;line-height:1.7;color:var(--tx2)}
.pv-snippet mark{background:rgba(255,98,0,.25);color:var(--acc);border-radius:2px;padding:0 2px;font-style:normal}
.pv-code{padding:12px;font-size:11px;line-height:1.6;color:var(--tx);font-family:var(--mono);overflow-x:auto;max-height:360px;overflow-y:auto;white-space:pre}
.pv-no-prev{display:flex;flex-direction:column;align-items:center;padding:32px;color:var(--tx2);gap:8px;text-align:center;font-size:12px}
/* ── PAGINATION ── */
.pagination{display:flex;align-items:center;justify-content:center;gap:5px;padding:10px;border-top:1px solid var(--bd);flex-shrink:0}
.pg-btn{width:26px;height:26px;border:1px solid var(--bd2);border-radius:5px;background:transparent;color:var(--tx2);font-size:12px;cursor:pointer;transition:all .1s;display:flex;align-items:center;justify-content:center}
.pg-btn:hover:not(:disabled){border-color:var(--acc);color:var(--acc)}
.pg-btn:disabled{opacity:.25;cursor:not-allowed}
.pg-info{font-size:11px;color:var(--tx2);font-family:var(--mono);padding:0 5px}
/* ── EMPTY/HERO ── */
.empty-hero{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;padding:40px;text-align:center}
.eh-icon{font-size:2.5rem;color:var(--acc)}
.eh-title{font-size:20px;font-weight:600;color:var(--tx)}
.eh-sub{font-size:13px;color:var(--tx2);max-width:380px}
.feature-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px;max-width:480px}
.feat{display:flex;align-items:flex-start;gap:10px;padding:12px;background:var(--s2);border:1px solid var(--bd);border-radius:8px;text-align:left}
.feat-icon{font-size:20px;flex-shrink:0}
.feat-t{font-size:12px;font-weight:500;color:var(--tx);margin-bottom:3px}
.feat-d{font-size:11px;color:var(--tx2);line-height:1.5}
.samples{padding:20px 28px}
.samples-title{font-size:11px;color:var(--tx2);margin-bottom:10px}
.samples-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.sample{padding:10px 14px;background:var(--s2);border:1px solid var(--bd);border-radius:7px;font-size:12px;color:var(--tx2);cursor:pointer;transition:all .15s}
.sample:hover{border-color:var(--acc);color:var(--tx);background:var(--acc3)}
.sample-content{border-color:rgba(96,165,250,.3);color:var(--blue)}
.sample-content:hover{border-color:var(--blue);background:rgba(96,165,250,.08)}
/* ── SHARED COMPONENTS ── */
.card{width:100%;background:var(--s1);border:1px solid var(--bd);border-radius:10px;padding:18px;margin-bottom:14px}
.card-title{font-size:11px;font-weight:600;color:var(--tx2);text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px}
.card-sub{font-size:12px;color:var(--tx2);margin-bottom:10px;line-height:1.6}
.btn-ghost{padding:8px 14px;border:1px solid var(--bd2);border-radius:7px;background:transparent;color:var(--tx);font-family:var(--ui);font-size:13px;cursor:pointer;transition:all .15s;white-space:nowrap}
.btn-ghost:hover{border-color:var(--acc);color:var(--acc)}
.inp{width:100%;padding:9px 12px;background:var(--bg);border:1px solid var(--bd2);border-radius:7px;color:var(--tx);font-size:12px;font-family:var(--mono);outline:none;transition:border-color .15s}
.inp:focus{border-color:var(--acc)}
.inp::placeholder{color:var(--tx3)}
.inp:disabled{opacity:.5}
.fl{display:block;font-size:10px;font-weight:600;color:var(--tx2);text-transform:uppercase;letter-spacing:.07em;margin-bottom:7px}
.fg{display:flex;flex-direction:column}
.field-row{display:flex;gap:12px}
.mono{font-family:var(--mono)}
.dim{color:var(--tx2)}
.pulse{animation:pulse 1.2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
/* content toggle */
.content-toggle{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;background:var(--s2);border:1px solid var(--bd2);border-radius:8px;cursor:pointer;transition:all .15s;margin-top:14px}
.content-toggle:hover{border-color:var(--bd3)}
.content-toggle.ct-on{background:rgba(255,98,0,.07);border-color:rgba(255,98,0,.3)}
.ct-dot{width:18px;height:18px;border:1.5px solid var(--bd2);border-radius:50%;flex-shrink:0;margin-top:2px;transition:all .15s;display:flex;align-items:center;justify-content:center}
.ct-on .ct-dot{background:var(--acc);border-color:var(--acc)}
.ct-on .ct-dot::after{content:'✓';font-size:10px;color:#fff}
.ct-title{font-size:13px;font-weight:500;color:var(--tx);margin-bottom:4px}
.ct-tag{padding:1px 6px;background:var(--acc3);color:var(--acc);border-radius:3px;font-size:9px;font-weight:600;margin-left:6px;letter-spacing:.05em}
.ct-desc{font-size:11px;color:var(--tx2);line-height:1.6}
.ct-caps{display:block;margin-top:5px;font-size:10px;color:var(--tx3);font-family:var(--mono)}
/* caps grid */
.caps-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cap-item{display:flex;align-items:center;gap:10px;padding:10px;background:var(--s2);border:1px solid var(--bd);border-radius:7px;opacity:.5}
.cap-item.cap-ready{opacity:1;border-color:rgba(52,211,153,.2)}
.cap-name{font-size:12px;font-weight:500;color:var(--tx)}
.cap-status{font-size:10px;color:var(--tx2);font-family:var(--mono)}
.cap-ready .cap-status{color:var(--green)}
/* progress */
.page-title{font-size:18px;font-weight:600;color:var(--tx);margin-bottom:14px}
.empty-sm{font-size:13px;color:var(--tx2);padding:8px 0}
.prog-wrap{margin-top:14px}
.prog-meta{display:flex;justify-content:space-between;margin-bottom:6px}
.prog-msg{font-size:11px;color:var(--tx2)}
.prog-n{font-size:12px;color:var(--acc);font-family:var(--mono)}
.prog-bar{height:3px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden}
.prog-fill{height:100%;background:linear-gradient(90deg,var(--acc),#ff9d68)}
.scan-anim{width:35%;animation:scan 1.6s ease-in-out infinite}
@keyframes scan{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}
.prog-skip{margin-top:5px;font-size:10px;color:var(--tx3);font-family:var(--mono)}
.scan-msg{margin-top:10px;padding:7px 11px;border-radius:6px;font-size:11px;display:inline-block}
.scan-msg.ok{background:rgba(52,211,153,.1);color:var(--green);border-left:3px solid var(--green)}
.scan-msg.info{background:rgba(255,255,255,.04);color:var(--tx2);border-left:3px solid var(--bd2)}
/* index table */
.idx-table{width:100%;border-collapse:collapse;font-size:12px}
.idx-table th{padding:7px 10px;text-align:left;font-size:10px;font-weight:600;color:var(--tx2);text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--bd)}
.idx-table td{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.04)}
.idx-table tr{cursor:pointer;transition:background .1s}
.idx-table tr:hover{background:var(--s2)}
.tr-active{background:var(--acc3)!important}
.td-name{font-weight:500;color:var(--tx)}
.td-dir{color:var(--tx2);font-family:var(--mono);font-size:10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-act{text-align:right}
.chip-st{padding:2px 7px;border-radius:10px;font-size:10px}
.chip-st.green{background:rgba(52,211,153,.12);color:var(--green)}
.chip-st.amber{background:rgba(245,158,11,.12);color:var(--amber)}
.act-btn{width:22px;height:22px;border:none;border-radius:4px;background:transparent;color:var(--tx2);font-size:11px;cursor:pointer;transition:all .1s;display:inline-flex;align-items:center;justify-content:center}
.act-btn:hover{background:var(--s3);color:var(--tx)}
.act-btn.danger:hover{background:rgba(248,113,113,.1);color:var(--red)}
/* timeline */
.tl-list{display:flex;flex-direction:column;gap:2px}
.tl-row{display:flex;align-items:center;gap:9px;padding:9px 12px;background:var(--s1);border-radius:7px;margin-bottom:2px;transition:background .1s}
.tl-row:hover{background:var(--s2)}
.tl-icon{font-size:16px;width:20px;text-align:center;flex-shrink:0}
.tl-info{flex:1;min-width:0}
.tl-name{font-size:12px;font-weight:500;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tl-path{font-size:10px;color:var(--tx2);font-family:var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tl-right{text-align:right;flex-shrink:0}
.tl-size{font-size:11px;color:var(--tx2);font-family:var(--mono)}
.tl-time{font-size:10px;color:var(--tx3)}
/* stats */
.stat-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:14px}
.stat-c{background:var(--s1);border:1px solid var(--bd);border-radius:10px;padding:16px}
.stat-highlight{border-color:rgba(255,98,0,.3)}
.stat-n{font-size:28px;font-weight:600;color:var(--acc);font-family:var(--mono);letter-spacing:-1px}
.stat-l{font-size:11px;color:var(--tx2);margin-top:4px}
.chart-wrap{display:flex;align-items:flex-end;gap:3px;height:72px;margin-top:8px}
.chart-bw{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;height:100%}
.chart-b{width:100%;background:rgba(255,98,0,.45);border-radius:2px 2px 0 0;transition:height .3s}
.chart-l{font-size:7px;color:var(--tx3);font-family:var(--mono);writing-mode:vertical-rl;transform:rotate(180deg)}
.query-list{display:flex;flex-direction:column;gap:6px}
.query-row{display:flex;align-items:center;gap:8px}
.query-term{flex:1;font-size:12px;color:var(--blue);font-family:var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.query-term:hover{text-decoration:underline}
.query-cnt{font-size:11px;color:var(--tx2);min-width:28px;text-align:right}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.ext-bars{display:flex;flex-direction:column;gap:7px}
.eb-row{display:flex;align-items:center;gap:7px;padding:3px 4px;border-radius:5px;transition:background .1s}
.eb-row:hover{background:var(--s2)}
.eb-icon{font-size:13px;width:16px;text-align:center}
.eb-ext{font-family:var(--mono);font-size:10px;color:var(--acc);width:80px}
.eb-track{flex:1;height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden}
.eb-fill{height:100%;background:linear-gradient(90deg,var(--acc),#ff9d68);transition:width .4s}
.eb-cnt{font-size:10px;color:var(--tx2);width:50px;text-align:right}
.cr-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.cr-rank{width:16px;font-size:10px;color:var(--tx3);font-family:var(--mono)}
.cr-name{flex:1;font-size:12px;color:var(--tx)}
.cr-cnt{font-size:10px;color:var(--tx2)}
.lf-row{display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.lf-icon{font-size:13px;width:16px;text-align:center}
.lf-name{flex:1;font-size:11px;color:var(--tx2);font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lf-size{font-size:11px;color:var(--acc);flex-shrink:0}
/* audit */
.audit-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px}
.audit-tools{display:flex;align-items:center;gap:8px}
.audit-select{padding:5px 8px;background:var(--s2);border:1px solid var(--bd2);border-radius:6px;color:var(--tx);font-size:11px;font-family:var(--ui);outline:none}
.audit-table{width:100%;border-collapse:collapse;font-size:12px}
.audit-table th{padding:8px 12px;text-align:left;font-size:10px;font-weight:600;color:var(--tx2);text-transform:uppercase;letter-spacing:.07em;background:var(--s2);border-bottom:1px solid var(--bd)}
.audit-table td{padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.04)}
.audit-query{font-family:var(--mono);font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.action-chip{padding:2px 7px;border-radius:10px;font-size:10px;font-weight:500}
/* dupes */
.dupe-list{display:flex;flex-direction:column;gap:8px}
.dupe-group{background:var(--s1);border:1px solid var(--bd);border-radius:8px;overflow:hidden}
.dupe-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--s2);font-size:13px}
.dupe-name{flex:1;font-weight:500;color:var(--tx)}
.dupe-size{font-size:11px;color:var(--tx2)}
.dupe-cnt{padding:2px 7px;background:rgba(248,113,113,.12);color:var(--red);border-radius:10px;font-size:11px}
.dupe-path{padding:5px 12px;font-size:10px;font-family:var(--mono);color:var(--tx2);border-top:1px solid var(--bd)}
/* settings */
.pat-list{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;min-height:24px}
.pat-item{display:flex;align-items:center;gap:5px;padding:3px 8px;background:var(--s2);border:1px solid var(--bd2);border-radius:5px}
.pat-txt{font-size:11px;color:var(--tx)}
.pat-add{display:flex;gap:8px;align-items:center}
.slider{width:100%;accent-color:var(--acc);margin:7px 0 4px;height:4px}
.slider-ends{display:flex;justify-content:space-between;font-size:10px;color:var(--tx3);margin-bottom:8px}
/* modal */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:999}
.modal{background:var(--s2);border:1px solid var(--bd2);border-radius:12px;padding:22px;width:340px;display:flex;flex-direction:column;gap:12px}
.modal-title{font-size:14px;font-weight:600;color:var(--tx)}
.modal-btns{display:flex;gap:8px;justify-content:flex-end}
/* kbd hints */
.kbd-hints{position:fixed;bottom:12px;right:14px;display:flex;align-items:center;gap:8px;opacity:.4;pointer-events:none}
.kbd{padding:2px 5px;background:var(--s3);border:1px solid var(--bd2);border-radius:4px;font-size:9px;font-family:var(--mono);color:var(--tx2)}
.kl{font-size:9px;color:var(--tx3)}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:3px}
@media(max-width:900px){
  .split-pane{flex-direction:column}
  .result-panel{width:100%;height:50%}
  .preview-panel{border-top:1px solid var(--bd)}
  .samples-grid,.two-col,.feature-grid,.stat-cards{grid-template-columns:1fr 1fr}
  .caps-grid{grid-template-columns:1fr}
  .field-row{flex-direction:column}
  .topnav .tnav:not(.tnav-on){display:none}
}
</style>
