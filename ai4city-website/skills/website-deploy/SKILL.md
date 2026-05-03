# AI4City Website 数据更新与部署 Skill

本项目为 React + Vite 单页应用，数据与渲染分离。所有内容修改只需改数据文件，无需改组件代码。

---

## 项目结构速览

```
ai4city-website/
├── src/data/
│   ├── team.jsx           # 团队成员 (PI / Postdoc / PhD / Master / RA / VS / Alumni)
│   ├── research.js        # Research 页面项目卡片
│   ├── publications.js    # Publications 页面论文列表
│   ├── articles.js        # 文章/新闻详情页内容
│   └── resources.js       # Data & Resources 页面资源列表
├── src/components/
│   ├── TeamPage.jsx
│   ├── ResearchListPage.jsx
│   ├── PublicationsListPage.jsx
│   └── ...
├── public/images/         # 静态图片（构建时会复制到 dist/）
│   ├── people/
│   ├── research/
│   ├── publication/
│   └── news/
├── package.json
└── BUILD.md
```

---

## 一、数据增删改查

### 1.1 修改团队成员 (`src/data/team.jsx`)

数据按类别分组，移动人员只需把整条记录剪切到对应数组：

| 数组键 | 英文名称 | 用途 |
|--------|----------|------|
| `pi` | Principal Investigator | 实验室负责人（单条对象） |
| `postphd` | Postdoc Researchers | 博士后 |
| `phd` | Ph.D. Students | 博士生 |
| `mst` | Master Students | 硕士生 |
| `ra` | Research Assistants | 研究助理 |
| `vst` | Visiting Students | 访问学生 |
| `vsc` | Visiting Scholars | 访问学者 |
| `alu` | Alumni | 校友 |

**字段格式：**
```javascript
{ name: "Zongrong Li", role: "Pre RA, now Phd at TAMU", email: "...", homepage: "...", img: "/images/people/Lizongrong.png" }
```
- `img` 路径前缀必须加 `/`，指向 `public/images/`
- Alumni 卡片默认不显示头像（`isAlumni=true` 时隐藏图片区域）

### 1.2 修改 Research 项目 (`src/data/research.js`)

**字段格式：**
```javascript
{
  id: "唯一标识",
  title: "论文/项目标题",
  desc: "1-2段摘要",
  mediaType: "image",          // image | video | map | custom
  mediaContent: "/images/research/xxx.png",
  link: "论文/项目主页链接",
  date: "May 6 2026",          // Research 卡片底部显示
  topic: "Urban Env-Understanding",  // 三选一，决定分栏
  year: "2026"
}
```

**topic 可选值（必须严格匹配）：**
- `AI based 3D City Modeling`
- `Spatio-temporal (4D) Data Fusion`
- `Urban Env-Understanding`

### 1.3 修改 Publications (`src/data/publications.js`)

**字段格式：**
```javascript
{
  id: "唯一标识",
  title: "论文标题",
  desc: "简短摘要（可选）",
  topic: "Urban Env-Understanding",  // 决定 filter 标签
  year: "2026",
  date: "期刊/会议名称, 年份. DOI: xxx",
  link: "https://doi.org/xxx",       // 主链接（论文页）
  projectLink: "https://github.com/...",  // 项目页（可选，显示蓝色按钮）
  wechatLink: "https://mp.weixin.qq.com/...",  // 微信推文（可选，显示绿色按钮）
  mediaContent: "/images/research/xxx.png"  // 封面图（可选）
}
```

### 1.4 添加新图片

1. 把图片放入 `public/images/` 下的对应子目录（如 `research/`、`people/`、`news/`）
2. 数据文件中引用路径格式：`/images/xxx/yyy.jpg`
3. 构建时 Vite 会自动把 `public/` 内容复制到 `dist/`

---

## 二、构建项目

```powershell
cd ai4city-website
npm run build
```

产物目录：`ai4city-website/dist/`
- `index.html`
- `assets/` (JS + CSS，带 hash)
- `images/` (从 public 复制的静态资源)

---

## 三、Git 提交与推送

```powershell
cd ai4city-website
git add src/data/xxx.js public/images/xxx
git commit -m "描述修改内容"
git push
```

**注意：** 工作目录下可能还有 `articles.js` 等其他未提交修改，只 add 本次变更的文件，避免把无关改动带进去。

---

## 四、部署到华为云 OBS

### 4.1 前置条件
- obsutil 已配置（`~/.obsutilconfig` 存在）
- 目标桶：`obs://ai4dcity-website`

### 4.2 增量部署步骤

**Step 1 — 删除旧构建产物**

Vite 每次构建 JS/CSS 文件名会变化（带 hash），必须删除旧 `assets/` 和 `index.html`：

```powershell
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe rm -r -f obs://ai4dcity-website/assets/
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe rm -f obs://ai4dcity-website/index.html
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe rm -f obs://ai4dcity-website/vite.svg
```

**Step 2 — 上传新构建产物**

```powershell
# assets 目录（JS + CSS）
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe cp -r -f ai4city-website\dist\assets obs://ai4dcity-website/

# 根目录文件
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe cp -f ai4city-website\dist\index.html obs://ai4dcity-website/
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe cp -f ai4city-website\dist\vite.svg obs://ai4dcity-website/
```

**Step 3 — 上传新增/变更的图片**

如果本次修改添加了新图片，单独上传：

```powershell
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe cp -f ai4city-website\dist\images\research\新图.jpg obs://ai4dcity-website/images/research/
```

> **切勿**使用 `obsutil cp -r -f ai4city-website\dist obs://ai4dcity-website/`，这会在 OBS 上创建多余的 `dist/` 前缀目录。

### 4.3 验证部署

```powershell
# 检查 index.html 修改时间
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe stat obs://ai4dcity-website/index.html

# 检查 assets 目录内容
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe ls obs://ai4dcity-website/assets/ -s
```

---

## 五、完整工作流示例

**场景：新增一篇论文到 Research 和 Publications**

```powershell
# 1. 添加图片
Copy-Item 新图.png ai4city-website\public\images\research\新图.png

# 2. 修改数据文件（用代码编辑工具）
#    - src/data/research.js  添加新条目
#    - src/data/publications.js 添加新条目

# 3. Git 提交
cd ai4city-website
git add src/data/research.js src/data/publications.js public/images/research/新图.png
git commit -m "add xxx paper"
git push

# 4. 构建
npm run build

# 5. 部署到 OBS
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe rm -r -f obs://ai4dcity-website/assets/
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe rm -f obs://ai4dcity-website/index.html
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe rm -f obs://ai4dcity-website/vite.svg
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe cp -r -f dist\assets obs://ai4dcity-website/
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe cp -f dist\index.html obs://ai4dcity-website/
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe cp -f dist\vite.svg obs://ai4dcity-website/
obsutil\obsutil_windows_amd64_5.8.3\obsutil.exe cp -f dist\images\research\新图.png obs://ai4dcity-website/images/research/
```

---

## 六、常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 网站刷新后看不到修改 | 浏览器缓存了旧 JS 文件 | 按 **Ctrl + F5** 强制刷新 |
| OBS 上 index.html 还是旧日期 | 上传到了 `dist/` 前缀下 | 删除 `obs://bucket/dist/` 目录，按 Step 2 正确上传 |
| 图片显示 404 | 图片没上传到 OBS | 单独上传新增图片到对应路径 |
| Research 卡片没显示 | `topic` 字段拼写错误 | 必须严格匹配三个预设值 |
