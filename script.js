// ===== Tab 切换 =====
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        link.classList.add('active');
        document.getElementById(link.dataset.tab).classList.add('active');
    });
});

// ===== 图片去水印核心 =====
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const editor = document.getElementById('editor');
const result = document.getElementById('result');
const mainCanvas = document.getElementById('mainCanvas');
const ctx = mainCanvas.getContext('2d', { willReadFrequently: true });
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');

let originalImage = null;
let displayImage = null;
let maskCanvas = null;
let maskCtx = null;
let currentMode = 'select';
let brushSize = 25;
let isDrawing = false;
let isSelecting = false;
let selectStart = null;
let selectEnd = null;
let maskHistory = [];
let scaleX = 1;
let scaleY = 1;
let offsetX = 0;
let offsetY = 0;

// 上传区域事件
uploadZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) loadImage(e.target.files[0]);
});

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]);
});

function loadImage(file) {
    if (!file.type.startsWith('image/')) { alert('请上传图片文件'); return; }
    if (file.size > 20 * 1024 * 1024) { alert('图片大小不能超过 20MB'); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
        originalImage = new Image();
        originalImage.onload = () => {
            initEditor();
            renderImage();
        };
        originalImage.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function initEditor() {
    uploadZone.style.display = 'none';
    result.style.display = 'none';
    editor.style.display = 'block';

    // 计算合适的显示尺寸
    const maxW = Math.min(editor.clientWidth - 64, 900);
    const maxH = Math.min(window.innerHeight * 0.65, 600);
    let w = originalImage.width, h = originalImage.height;
    if (w > maxW) { h = h * (maxW / w); w = maxW; }
    if (h > maxH) { w = w * (maxH / h); h = maxH; }
    mainCanvas.width = Math.round(w);
    mainCanvas.height = Math.round(h);
    scaleX = originalImage.width / w;
    scaleY = originalImage.height / h;

    // 初始化遮罩画布
    maskCanvas = document.createElement('canvas');
    maskCanvas.width = originalImage.width;
    maskCanvas.height = originalImage.height;
    maskCtx = maskCanvas.getContext('2d');
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskHistory = [];
    saveMaskState();
}

function renderImage() {
    ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    ctx.drawImage(originalImage, 0, 0, mainCanvas.width, mainCanvas.height);

    // 绘制遮罩叠加层
    if (maskCanvas) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = mainCanvas.width;
        tempCanvas.height = mainCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(maskCanvas, 0, 0, mainCanvas.width, mainCanvas.height);
        const maskData = tempCtx.getImageData(0, 0, mainCanvas.width, mainCanvas.height);

        ctx.save();
        for (let i = 0; i < maskData.data.length; i += 4) {
            if (maskData.data[i] > 128) {
                ctx.fillStyle = 'rgba(255, 0, 0, 0.35)';
                const x = (i / 4) % mainCanvas.width;
                const y = Math.floor(i / 4 / mainCanvas.width);
                ctx.fillRect(x, y, 1, 1);
            }
        }
        ctx.restore();
    }

    // 绘制选择框
    if (selectStart && selectEnd) {
        const x = Math.min(selectStart.x, selectEnd.x);
        const y = Math.min(selectStart.y, selectEnd.y);
        const w = Math.abs(selectEnd.x - selectStart.x);
        const h = Math.abs(selectEnd.y - selectStart.y);
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
    }
}

// Canvas 鼠标事件
mainCanvas.addEventListener('mousedown', (e) => {
    const rect = mainCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (currentMode === 'select') {
        isSelecting = true;
        selectStart = { x, y };
        selectEnd = { x, y };
    } else if (currentMode === 'brush') {
        isDrawing = true;
        drawBrush(x, y);
    }
});

mainCanvas.addEventListener('mousemove', (e) => {
    const rect = mainCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isSelecting) {
        selectEnd = { x, y };
        renderImage();
    } else if (isDrawing) {
        drawBrush(x, y);
    }
});

mainCanvas.addEventListener('mouseup', () => {
    if (isSelecting) {
        isSelecting = false;
        if (selectStart && selectEnd) {
            applySelectionToMask();
        }
        selectStart = null;
        selectEnd = null;
    }
    if (isDrawing) {
        isDrawing = false;
        saveMaskState();
    }
});

mainCanvas.addEventListener('mouseleave', () => {
    isSelecting = false;
    isDrawing = false;
});

// 触摸事件支持
mainCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const rect = mainCanvas.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    if (currentMode === 'brush') {
        isDrawing = true;
        drawBrush(x, y);
    } else if (currentMode === 'select') {
        isSelecting = true;
        selectStart = { x, y };
        selectEnd = { x, y };
    }
});

mainCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const rect = mainCanvas.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    if (isDrawing) drawBrush(x, y);
    if (isSelecting) {
        selectEnd = { x, y };
        renderImage();
    }
});

mainCanvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (isSelecting) {
        isSelecting = false;
        if (selectStart && selectEnd) applySelectionToMask();
        selectStart = null; selectEnd = null;
    }
    if (isDrawing) { isDrawing = false; saveMaskState(); }
});

function drawBrush(x, y) {
    const radius = brushSize / 2;
    maskCtx.fillStyle = 'white';
    maskCtx.beginPath();
    maskCtx.arc(x * scaleX, y * scaleY, radius * scaleX, 0, Math.PI * 2);
    maskCtx.fill();
    renderImage();
}

function applySelectionToMask() {
    const x1 = Math.min(selectStart.x, selectEnd.x);
    const y1 = Math.min(selectStart.y, selectEnd.y);
    const x2 = Math.max(selectStart.x, selectEnd.x);
    const y2 = Math.max(selectStart.y, selectEnd.y);

    maskCtx.fillStyle = 'white';
    maskCtx.fillRect(x1 * scaleX, y1 * scaleY, (x2 - x1) * scaleX, (y2 - y1) * scaleY);
    saveMaskState();
    renderImage();
}

function saveMaskState() {
    const data = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    maskHistory.push(data);
    if (maskHistory.length > 50) maskHistory.shift();
}

// 工具栏按钮
document.querySelectorAll('.tool-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn[data-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
    });
});

document.querySelectorAll('.tool-btn[data-size]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn[data-size]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        brushSize = parseInt(btn.dataset.size);
    });
});

document.getElementById('clearMask').addEventListener('click', () => {
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    saveMaskState();
    renderImage();
});

document.getElementById('undoMask').addEventListener('click', () => {
    if (maskHistory.length > 1) {
        maskHistory.pop();
        const prev = maskHistory[maskHistory.length - 1];
        maskCtx.putImageData(prev, 0, 0);
        renderImage();
    }
});

// ===== 图片处理 =====
document.getElementById('processBtn').addEventListener('click', () => {
    const method = document.getElementById('removeMethod').value;
    showLoading('正在去除水印...');
    setTimeout(() => processImage(method), 300);
});

function processImage(method) {
    const w = originalImage.width, h = originalImage.height;
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = w;
    outputCanvas.height = h;
    const outCtx = outputCanvas.getContext('2d');
    outCtx.drawImage(originalImage, 0, 0);

    const maskData = maskCtx.getImageData(0, 0, w, h);
    const imgData = outCtx.getImageData(0, 0, w, h);

    switch (method) {
        case 'inpaint': inpaintRemove(imgData, maskData); break;
        case 'blur': blurRemove(imgData, maskData); break;
        case 'crop': cropRemove(imgData, maskData, outCtx, outputCanvas); break;
        case 'solid': solidRemove(imgData, maskData); break;
    }

    outCtx.putImageData(imgData, 0, 0);
    hideLoading();

    // 显示结果
    editor.style.display = 'none';
    result.style.display = 'block';
    document.getElementById('originalPreview').src = originalImage.src;
    document.getElementById('resultPreview').src = outputCanvas.toDataURL('image/png');
    result.dataset.resultData = outputCanvas.toDataURL('image/png');
    result.dataset.resultCanvas = outputCanvas;
}

// 智能填充 - 用周围像素填充水印区域
function inpaintRemove(imgData, maskData) {
    const w = imgData.width, h = imgData.height;
    const pixels = imgData.data;
    const mask = maskData.data;

    // 找到所有水印像素
    const markPixels = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (mask[i] > 128) markPixels.push({ x, y });
        }
    }
    if (markPixels.length === 0) return;

    // 对每个水印像素用周围非水印像素的平均值填充
    for (const { x, y } of markPixels) {
        let r = 0, g = 0, b = 0, count = 0;

        for (let dy = -5; dy <= 5; dy++) {
            for (let dx = -5; dx <= 5; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                const ni = (ny * w + nx) * 4;
                if (mask[ni] <= 128) {
                    r += pixels[ni];
                    g += pixels[ni + 1];
                    b += pixels[ni + 2];
                    count++;
                }
            }
        }

        const i = (y * w + x) * 4;
        if (count > 0) {
            pixels[i] = Math.round(r / count);
            pixels[i + 1] = Math.round(g / count);
            pixels[i + 2] = Math.round(b / count);
        }
    }
}

// 高斯模糊近似
function blurRemove(imgData, maskData) {
    const w = imgData.width, h = imgData.height;
    const pixels = imgData.data;
    const mask = maskData.data;

    // 收集需要模糊的区域
    const toBlur = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (mask[i] > 128) toBlur.push({ x, y });
        }
    }
    if (toBlur.length === 0) return;

    // 多次高斯模糊
    const radius = 8;
    const iterations = 3;
    const temp = new Uint8ClampedArray(pixels);

    for (let iter = 0; iter < iterations; iter++) {
        for (const { x, y } of toBlur) {
            let r = 0, g = 0, b = 0, a = 0, count = 0;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                    const ni = (ny * w + nx) * 4;
                    r += temp[ni];
                    g += temp[ni + 1];
                    b += temp[ni + 2];
                    a += temp[ni + 3];
                    count++;
                }
            }
            const i = (y * w + x) * 4;
            pixels[i] = Math.round(r / count);
            pixels[i + 1] = Math.round(g / count);
            pixels[i + 2] = Math.round(b / count);
            pixels[i + 3] = Math.round(a / count);
        }
        temp.set(pixels);
    }
}

// 裁剪去除 - 直接裁掉水印区域
function cropRemove(imgData, maskData, outCtx, outputCanvas) {
    const w = imgData.width, h = imgData.height;
    const mask = maskData.data;

    // 找到水印的边界框
    let minX = w, minY = h, maxX = 0, maxY = 0;
    let hasMask = false;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (mask[(y * w + x) * 4] > 128) {
                hasMask = true;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (!hasMask) return;

    // 计算去掉水印后的区域（保留上部分为主）
    const cropH = minY > 10 ? minY : Math.max(maxY + 1, h - maxY - 1) > h / 2 ? Math.max(maxY + 1, h - maxY - 1) : h - maxY - 1;
    const keepTop = minY > 10;
    const srcY = keepTop ? 0 : maxY + 1;
    const newH = keepTop ? minY : h - maxY - 1;

    outputCanvas.width = w;
    outputCanvas.height = newH;
    outCtx.clearRect(0, 0, w, newH);
    outCtx.putImageData(new ImageData(new Uint8ClampedArray(imgData.data.buffer.slice(srcY * w * 4, (srcY + newH) * w * 4)), w, newH), 0, 0);
}

// 纯色覆盖
function solidRemove(imgData, maskData) {
    const w = imgData.width, h = imgData.height;
    const pixels = imgData.data;
    const mask = maskData.data;

    // 取周围像素均值作为填充色
    let r = 255, g = 255, b = 255, count = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (mask[i] <= 128) { r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; count++; }
        }
    }
    r = count > 0 ? Math.round(r / count) : 255;
    g = count > 0 ? Math.round(g / count) : 255;
    b = count > 0 ? Math.round(b / count) : 255;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (mask[i] > 128) {
                pixels[i] = r;
                pixels[i + 1] = g;
                pixels[i + 2] = b;
            }
        }
    }
}

// 下载按钮
document.getElementById('downloadBtn').addEventListener('click', () => {
    const dataUrl = result.dataset.resultData;
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.download = '去水印结果.png';
    link.href = dataUrl;
    link.click();
});

document.getElementById('reEditBtn').addEventListener('click', () => {
    result.style.display = 'none';
    editor.style.display = 'block';
});

document.getElementById('newImageBtn').addEventListener('click', () => {
    result.style.display = 'none';
    editor.style.display = 'none';
    uploadZone.style.display = 'block';
    originalImage = null;
    maskCanvas = null;
    maskHistory = [];
});

// ===== 视频解析 =====
document.getElementById("parseBtn").addEventListener("click", parseVideo);
document.getElementById("videoUrl").addEventListener("keydown", (e) => {
    if (e.key === "Enter") parseVideo();
});

async function parseVideo() {
    const url = document.getElementById("videoUrl").value.trim();
    if (!url) { alert("请先粘贴视频分享链接"); return; }

    let platform = null;
    if (url.includes("douyin.com") || url.includes("iesdouyin.com")) platform = "douyin";
    else if (url.includes("kuaishou.com")) platform = "kuaishou";
    else if (url.includes("xhslink.com") || url.includes("xiaohongshu.com")) platform = "xiaohongshu";
    else {
        showVideoError("暂不支持该平台。目前支持：抖音、快手、小红书。");
        return;
    }

    showLoading("正在解析视频链接...");

    // Priority 1: Our own Vercel API (most reliable)
    let apiUrl = "/api/parse?url=" + encodeURIComponent(url);
    let data = await tryFetch(apiUrl);

    // Priority 2: Direct third-party APIs with CORS proxy fallback
    if (!data) {
        loadingText.textContent = "正在尝试备用接口...";
        const thirdParty = [
            "https://tenapi.cn/v2/video/" + platform + "?url=" + encodeURIComponent(url),
            "https://api.oioweb.cn/api/video/" + platform + "?url=" + encodeURIComponent(url),
        ];
        const proxies = [
            "https://api.allorigins.win/raw?url=",
            "https://api.codetabs.com/v1/proxy?quest=",
        ];
        for (const tp of thirdParty) {
            data = await tryFetch(tp);
            if (!data) {
                for (const proxy of proxies) {
                    data = await tryFetch(proxy + encodeURIComponent(tp));
                    if (data) {
                        if (proxy.includes("allorigins") && typeof data === "string") {
                            try { data = JSON.parse(data); } catch(e) { data = null; continue; }
                        }
                        break;
                    }
                }
            }
            if (data) break;
        }
    }

    hideLoading();

    if (data) {
        let videoUrl = null, title = "";
        // Our own API response format
        if (data.video_url) {
            videoUrl = data.video_url;
            title = data.title || "";
        }
        // tenapi.cn format
        else if (data.data && data.data.video_url) {
            videoUrl = data.data.video_url;
            title = data.data.title || "";
        }
        // oioweb format
        else if (data.result && data.result.url) {
            videoUrl = data.result.url;
            title = data.result.title || "";
        }

        if (videoUrl) {
            showVideoResult(videoUrl, title);
            return;
        }
    }

    showVideoError("解析失败。请确认链接有效后重试，或换个链接。");
}

function showVideoError(msg) {
    document.getElementById("videoResult").style.display = "block";
    document.getElementById("videoInfo").innerHTML = "<p style='color:#b45309;'>" + msg + "</p>";
}

async function tryFetch(url) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        return null;
    }
}

function showVideoResult(videoUrl, title) {
    document.getElementById("videoResult").style.display = "block";
    document.getElementById("videoPlayer").src = videoUrl;
    document.getElementById("videoInfo").innerHTML =
        "<p style='color:#16a34a;'>解析成功！</p>" +
        (title ? "<p>标题：" + title + "</p>" : "") +
        "<p style='font-size:12px;color:#64748b;'>如无法在线播放，点击下载按钮保存到本地</p>";

    document.getElementById("videoDownloadBtn").onclick = () => {
        const a = document.createElement("a");
        a.href = videoUrl;
        a.download = "video.mp4";
        a.target = "_blank";
        a.click();
    };
}

document.getElementById("videoDownloadBtn").addEventListener("click", () => {
    const videoUrl = document.getElementById("videoPlayer").src;
    if (videoUrl) {
        window.open(videoUrl, "_blank");
    }
});


// ===== 辅助函数 =====
function showLoading(text) {
    loadingText.textContent = text || '处理中...';
    loadingOverlay.style.display = 'flex';
}

function hideLoading() {
    loadingOverlay.style.display = 'none';
}
