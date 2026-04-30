# 构建与本地运行命令

项目在 **`ai4city-website`** 目录下（与 `package.json` 同级）。在仓库根目录 `ai4dcity_react` 直接执行 `npm` 会报错，请先进入子目录。

## 进入项目目录

```powershell
cd D:\ai4city-website\ai4dcity_react\ai4city-website
```

（路径按你本机克隆位置调整。）

## 安装依赖（首次或依赖变更后）

```powershell
npm install
```

## 开发模式（热更新）

```powershell
npm run dev
```

## 生产构建

```powershell
npm run build
```

产物目录：**`dist/`**。部署静态托管时上传 **`dist` 内的所有文件和文件夹** 到网站根路径，不要多包一层 `dist` 目录名。

## 本地预览构建结果（推荐部署前自检）

```powershell
npm run preview
```

默认一般为 `http://localhost:4173`，用于验证与线上一致的打包效果。

## 代码检查

```powershell
npm run lint
```

## 脚本一览（来自 package.json）

| 命令            | 说明           |
|-----------------|----------------|
| `npm run dev`   | Vite 开发服务器 |
| `npm run build` | 生产构建 → `dist/` |
| `npm run preview` | 本地预览 `dist` |
| `npm run lint`  | ESLint         |
