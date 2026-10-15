/**
 * ============================================================================
 *  抖音极速版 · 红包判色自动刷视频        AutoJs6 (Rhino / ES5 兼容版)
 * ----------------------------------------------------------------------------
 *  逻辑：进入视频后轮询红包「主体」颜色
 *        金色(GOLD)  -> 红包还在计时，继续看；并在首次判定金色时点一个赞
 *        红色(RED)   -> 红包已结束，立即上滑切下一个视频
 *        无挂件      -> 按正常看完处理（有宽限期，避免疯狂连续滑动）
 *  停止：音量上键
 * ----------------------------------------------------------------------------
 *  说明：全部使用 var / 无尾随逗号 / 不用 Uint8Array / 不用 "ui" 指令，
 *        以兼容 AutoJs6 内置的 Rhino 解析器（它比 V8/Node 严格）。
 * ============================================================================
 */

// ============================== 0. 配置区 ==============================
var MODE = "run"; // "run" 正常运行 | "calibrate" 标定自检

var CFG = {
    // ---- 红包主体采样区（已按两张全屏截图实测标定）----
    // 实测：红图 864x1920 与 金图 1080x2400 的挂件归一化中心都是 (89.2%W, 19.4%H)
    //      主体尺寸约 8.3%W x 3.8%H，故用归一化坐标，换分辨率/换机自动适配
    BODY_NORM: { x: 0.853, y: 0.177, w: 0.077, h: 0.034 },
    BODY_REF: { w: 1080, h: 2400 },   // 标定时的参考分辨率（仅用于日志核对）
    // 想写死绝对像素就填这里（w>0 时优先生效）；留 0 则使用上面的归一化值
    BODY: { x: 0, y: 0, w: 0, h: 0 },

    // ---- 判色阈值（实测：金 H约41度，红 H约353度；圆环/圆钮 S约0.24 会被过滤）----
    S_MIN: 0.36,        // 饱和度下限：过滤奶油色圆钮、外圈进度环（实测它们 S≈0.24，留足余量）
    V_MIN: 0.38,        // 亮度下限：过滤深色背景
    RED_H: [322, 30],   // 红色色相区间 (H>=322 或 H<=30)
    GOLD_H: [30, 70],   // 金色色相区间
    GOLD_RATIO: 1.2,    // 金像素 > 红像素*1.2 才算金色
    MIN_VALID: 12,      // 有效暖色像素少于该值 -> 判定为「无挂件」

    // ---- 旧机/低配适配（OPPO A72 这类骁龙 6xx / 天玑 7xx 建议保持 true）----
    // true  : 每次判定只截 1 帧，靠 STABLE_HITS 跨轮次去抖；采样点更稀疏，最省 CPU 和内存
    // false : 每次判定截 3 帧取多数票，更抗转场/动效误判，但慢约 3 倍、更吃内存
    PERF_LOW: true,

    // ---- 采样 ----
    SAMPLE_TIMES: 3,    // PERF_LOW=false 时每次判定的采样次数（取多数票）
    SAMPLE_GAP_MS: 200,
    PIXEL_STEP: 4,      // 区域内每隔几像素采一个点（3~5 可用，越大越快）

    // ---- 节奏与稳定化（极速档；括号里是原来的保守值，想换回就照抄）----
    STABLE_HITS: 2,     // 连续多少次结论一致才动作（别降到 1：这是唯一防「单帧误读就滑走」的闸门）
    POLL_MS: 250,       // 判定轮询间隔（原 400）
    MAX_WATCH_MS: 60000,    // 金色时单个视频最长停留，超时兜底滑走
    START_GRACE_MS: 1200,   // 视频开始后不判定，等加载/挂件出现（原 2000）
    NOWIDGET_GRACE_MS: 8000,// 无挂件持续多久才认为真的没有（别调小，否则新视频会连滑）

    // ---- 滑动 ----
    SWIPE_FROM_Y: 0.78, SWIPE_TO_Y: 0.25,
    SWIPE_MS_MIN: 180, SWIPE_MS_MAX: 380,   // 保留随机区间，别固定成同一个速度
    WAIT_MIN_MS: 700, WAIT_MAX_MS: 1200,    // 滑动后等待新视频（原 1200~2500）

    // ---- 点赞（金色红包的视频）----
    LIKE_ON_GOLD: true,
    LIKE_DELAY_MS: 800,
    LIKE_POINT: { x: 0.50, y: 0.42 },   // 归一化坐标，双击点赞

    // ---- 自动搜索定位（仅在未标定/需要重定位时使用）----
    SEARCH_STEP: 6,
    // 只搜右上角：实测挂件在 (89%, 19%)；收窄范围既提速，又避开视频里的红/金画面
    // 和底部那个开宝箱红包按钮（否则会被误认成挂件）
    SEARCH_REGION: { x1: 0.55, y1: 0.04, x2: 1.00, y2: 0.35 },
    RELOCATE_EVERY: 30, // 每刷 N 个视频重新自动定位一次；0=不重定位

    // ---- 运行控制 ----
    MAX_VIDEOS: 0,      // 0=无限
    MAX_MINUTES: 0,     // 0=无限
    CLOSE_POPUP: true,  // 卡住时尝试关闭弹窗

    // ---- 极速档护栏：连续快速滑走太多次时插一次较长停顿，避免像机器人在刷 ----
    RED_STREAK_PAUSE_AFTER: 6,      // 连续 N 个「红包已结束」就停顿一次；0=关闭
    RED_STREAK_PAUSE_MS: 4000,

    // ---- 前台/息屏守卫（旧机必备：防止脚本在别的界面乱滑、息屏空转）----
    GUARD_ENABLED: true,
    TARGET_PKG: "com.ss.android.ugc.aweme.lite",   // 抖音极速版包名
    GUARD_RETRY: 1,     // 连续几次不在前台就暂停；1=立刻暂停（宁可多等 3 秒，也不在别的界面滑动）

    // ---- 调试 ----
    VERBOSE: true,
    SAVE_DIR: "/sdcard/autojs_douyin/"
};

// ============================== 1. 全局状态 ==============================
var STOP = false;
var stats = { videos: 0, red: 0, goldTimeout: 0, noWidget: 0, likes: 0, unknown: 0 };
var logLines = [];

function log(msg) {
    var line = "[" + new Date().toTimeString().substring(0, 8) + "] " + msg;
    console.log(line);
    logLines.push(line);
    if (logLines.length > 4000) logLines.shift();
}

// ============================== 2. 颜色工具 ==============================
function rgbOf(c) {
    return { r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff };
}

function hsvOf(r, g, b) {
    var R = r / 255, G = g / 255, B = b / 255;
    var mx = Math.max(R, Math.max(G, B));
    var mn = Math.min(R, Math.min(G, B));
    var d = mx - mn;
    var h = 0;
    if (d > 1e-6) {
        if (mx === R) {
            h = 60 * (((G - B) / d) % 6);
        } else if (mx === G) {
            h = 60 * ((B - R) / d + 2);
        } else {
            h = 60 * ((R - G) / d + 4);
        }
    }
    if (h < 0) h += 360;
    return { h: h, s: mx > 0 ? d / mx : 0, v: mx };
}

// 返回 "RED" / "GOLD" / "NONE"
function classify(r, g, b) {
    var c = hsvOf(r, g, b);
    if (c.s <= CFG.S_MIN || c.v <= CFG.V_MIN) return "NONE";
    if (c.h >= CFG.RED_H[0] || c.h <= CFG.RED_H[1]) return "RED";
    if (c.h > CFG.GOLD_H[0] && c.h < CFG.GOLD_H[1]) return "GOLD";
    return "NONE";
}

// ============================== 3. 截图 ==============================
function ensureCapture() {
    var i;
    for (i = 0; i < 3; i++) {
        try {
            if (requestScreenCapture()) return true;
        } catch (e) {
            log("requestScreenCapture 异常: " + e);
        }
        try {
            if (images.requestScreenCapture()) return true;
        } catch (e2) {
            // ignore
        }
        sleep(800);
    }
    return false;
}

function grabImage() {
    var img = null;
    try {
        img = captureScreen();
        if (img) return img;
    } catch (e) {
        // fallthrough
    }
    try {
        return images.captureScreen();
    } catch (e2) {
        return null;
    }
}

// ============================== 4. 区域判色 ==============================
// 兼容旧机：个别 ROM / 硬件位图下 Image.pixel 会失效，退回 images.pixel
function readPixel(img, x, y) {
    try {
        return img.pixel(x, y);
    } catch (e) { /* fallthrough */ }
    try {
        return images.pixel(img, x, y);
    } catch (e2) { /* fallthrough */ }
    return 0xffffffff;
}

function sampleRect(img, rect) {
    var W = img.width, H = img.height;
    var x0 = Math.max(0, Math.floor(rect.x));
    var y0 = Math.max(0, Math.floor(rect.y));
    var w = Math.min(Math.floor(rect.w), W - x0);
    var h = Math.min(Math.floor(rect.h), H - y0);
    var red = 0, gold = 0, none = 0;
    var sampleRgb = null;
    var step = Math.max(1, CFG.PIXEL_STEP);
    var x, y, c, r, g, b, k;
    for (y = 0; y < h; y += step) {
        for (x = 0; x < w; x += step) {
            c = readPixel(img, x0 + x, y0 + y);
            r = (c >> 16) & 0xff;
            g = (c >> 8) & 0xff;
            b = c & 0xff;
            k = classify(r, g, b);
            if (k === "RED") {
                red++;
                if (!sampleRgb) sampleRgb = [r, g, b];
            } else if (k === "GOLD") {
                gold++;
                if (!sampleRgb) sampleRgb = [r, g, b];
            } else {
                none++;
            }
        }
    }
    return { red: red, gold: gold, none: none, valid: red + gold, rgb: sampleRgb };
}

function verdictOf(s) {
    if (s.valid < CFG.MIN_VALID) return "NO_WIDGET";
    if (s.red > s.gold) return "RED";
    if (s.gold > s.red * CFG.GOLD_RATIO) return "GOLD";
    return "UNKNOWN";
}

// 多次采样取多数票（PERF_LOW=true 时只采 1 次，靠 STABLE_HITS 跨轮次去抖）
function sampleVerdict(rect) {
    var votes = {};
    var detail = null;
    var i, img, s, v;
    var times = CFG.PERF_LOW ? 1 : CFG.SAMPLE_TIMES;
    if (times < 1) times = 1;
    var tBeg = Date.now();
    for (i = 0; i < times && !STOP; i++) {
        img = grabImage();
        if (!img) {
            votes["NO_WIDGET"] = (votes["NO_WIDGET"] || 0) + 1;
            continue;
        }
        s = sampleRect(img, rect);
        v = verdictOf(s);
        detail = s;
        votes[v] = (votes[v] || 0) + 1;
        try { img.recycle(); } catch (e) { /* ignore */ }
        if (i < times - 1) sleep(CFG.SAMPLE_GAP_MS);
    }
    var best = "UNKNOWN", bestN = -1, key;
    for (key in votes) {
        if (votes[key] > bestN) {
            bestN = votes[key];
            best = key;
        }
    }
    // 平票时偏向「继续看」：宁可多看一个视频，也不要把还在计时的红包误判成红色滑走
    if (votes["RED"] && votes["GOLD"] && votes["RED"] === votes["GOLD"]) best = "GOLD";
    if (CFG.VERBOSE) {
        var cost = Date.now() - tBeg;
        if (cost > 1200) log("  [性能] 本次判定耗时 " + cost + "ms（偏慢：可加大 PIXEL_STEP）");
    }
    if (CFG.VERBOSE && detail) {
        var hsv = detail.rgb ? hsvOf(detail.rgb[0], detail.rgb[1], detail.rgb[2]) : null;
        log("  采样 红=" + detail.red + " 金=" + detail.gold + " 其他=" + detail.none +
            (hsv ? "  样本RGB=" + detail.rgb.join(",") + " H=" + hsv.h.toFixed(0) +
                   " S=" + hsv.s.toFixed(2) + " V=" + hsv.v.toFixed(2) : "") +
            "  => " + best);
    }
    return best;
}

// ============================== 5. 自动定位红包主体 ==============================
function findBodyRect(img) {
    var W = img.width, H = img.height;
    var R = CFG.SEARCH_REGION;
    var rx1 = Math.floor(R.x1 * W), ry1 = Math.floor(R.y1 * H);
    var rx2 = Math.floor(R.x2 * W), ry2 = Math.floor(R.y2 * H);
    var step = Math.max(2, CFG.SEARCH_STEP);
    var cols = Math.floor((rx2 - rx1) / step);
    var rows = Math.floor((ry2 - ry1) / step);
    if (cols < 2 || rows < 2) return null;

    var grid = [];   // 0/1 标记（用普通数组，Rhino 没有 Uint8Array）
    var i, j, c, k, idx;
    for (j = 0; j < rows; j++) {
        for (i = 0; i < cols; i++) {
            c = readPixel(img, rx1 + i * step, ry1 + j * step);
            k = classify((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
            grid[j * cols + i] = (k === "NONE") ? 0 : 1;
        }
    }

    // 最大连通域（4 邻域）
    var seen = [];
    var best = null;
    var stack, pts, p, py, px, q, ny, nx, n;
    var nb = [];
    for (j = 0; j < rows; j++) {
        for (i = 0; i < cols; i++) {
            idx = j * cols + i;
            if (!grid[idx] || seen[idx]) continue;
            stack = [idx];
            seen[idx] = 1;
            pts = [];
            while (stack.length > 0) {
                p = stack.pop();
                pts.push(p);
                py = Math.floor(p / cols);
                px = p % cols;
                nb = [[py + 1, px], [py - 1, px], [py, px + 1], [py, px - 1]];
                for (n = 0; n < 4; n++) {
                    ny = nb[n][0];
                    nx = nb[n][1];
                    if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) continue;
                    q = ny * cols + nx;
                    if (grid[q] && !seen[q]) {
                        seen[q] = 1;
                        stack.push(q);
                    }
                }
            }
            if (!best || pts.length > best.length) best = pts;
        }
    }
    if (!best || best.length < 30) return null;

    var minI = 1e9, maxI = -1, minJ = 1e9, maxJ = -1;
    for (n = 0; n < best.length; n++) {
        py = Math.floor(best[n] / cols);
        px = best[n] % cols;
        if (px < minI) minI = px;
        if (px > maxI) maxI = px;
        if (py < minJ) minJ = py;
        if (py > maxJ) maxJ = py;
    }
    var x = rx1 + minI * step, y = ry1 + minJ * step;
    var w = (maxI - minI + 1) * step, h = (maxJ - minJ + 1) * step;

    // 尺寸合理性：主体约占屏宽 4%~30%
    if (w < W * 0.04 || w > W * 0.30 || h < H * 0.02 || h > H * 0.30) {
        log("  搜索到色块但尺寸不合理: " + w + "x" + h);
        return null;
    }
    var ratio = w / h;
    if (ratio < 0.4 || ratio > 2.5) {
        log("  搜索到色块但长宽比不合理: " + ratio.toFixed(2));
        return null;
    }
    // 内缩 12%，避开边缘描边与中央圆钮影响
    return {
        x: Math.round(x + w * 0.12),
        y: Math.round(y + h * 0.12),
        w: Math.round(w * 0.76),
        h: Math.round(h * 0.76)
    };
}

// ============================== 5b. 采样区解析与自检 ==============================
// 基准尺寸优先用「截图本身」的宽高，而不是 device.width/height
// —— 分屏、显示缩放、部分 ROM 会让两者不一致，截图宽高才是像素级真值
function resolveRect(imgW, imgH) {
    if (CFG.BODY.w > 0 && CFG.BODY.h > 0) {
        return { x: CFG.BODY.x, y: CFG.BODY.y, w: CFG.BODY.w, h: CFG.BODY.h };
    }
    var n = CFG.BODY_NORM;
    if (!n || !(n.w > 0)) return null;
    var W = imgW, H = imgH;
    if (!W || !H) {
        W = device.width;
        H = device.height;
    }
    if (!W || !H) {
        W = CFG.BODY_REF.w;
        H = CFG.BODY_REF.h;
    }
    return {
        x: Math.round(n.x * W),
        y: Math.round(n.y * H),
        w: Math.round(n.w * W),
        h: Math.round(n.h * H)
    };
}

// 启动时打印一次当前颜色，确认采样区没跑偏
function verifyRect(rect) {
    var img = grabImage();
    if (!img) {
        log("启动自检：截图失败");
        return;
    }
    var s = sampleRect(img, rect);
    try { img.recycle(); } catch (e) { /* ignore */ }
    var v = verdictOf(s);
    log("启动自检：红=" + s.red + " 金=" + s.gold + " 其他=" + s.none + " => " + v +
        (s.valid < CFG.MIN_VALID ? "   [警告] 采样区可能没对准红包，请用 MODE=calibrate 重新标定" : ""));
}

// ============================== 6. 动作 ==============================
function randInt(a, b) {
    return Math.floor(a + Math.random() * (b - a + 1));
}

function swipeNext() {
    var W = device.width, H = device.height;
    var x = Math.floor(W * (0.45 + Math.random() * 0.10));
    var y1 = Math.floor(H * CFG.SWIPE_FROM_Y);
    var y2 = Math.floor(H * CFG.SWIPE_TO_Y);
    swipe(x, y1, x, y2, randInt(CFG.SWIPE_MS_MIN, CFG.SWIPE_MS_MAX));
    sleep(randInt(CFG.WAIT_MIN_MS, CFG.WAIT_MAX_MS));
}

function doubleTapLike() {
    var x = Math.floor(device.width * CFG.LIKE_POINT.x);
    var y = Math.floor(device.height * CFG.LIKE_POINT.y);
    click(x, y);
    sleep(70);
    click(x, y);
    stats.likes++;
    log("  已点赞（双击 " + x + "," + y + "）");
}

function tryClosePopup() {
    if (!CFG.CLOSE_POPUP) return false;
    var words = ["跳过", "关闭", "我知道了", "以后再说"];
    var i, n, b;
    for (i = 0; i < words.length; i++) {
        try {
            n = textContains(words[i]).findOnce();
            if (n) {
                b = n.bounds();
                if (b && b.width() > 0) {
                    click(b.centerX(), b.centerY());
                    log("  关闭弹窗: " + words[i]);
                    sleep(600);
                    return true;
                }
            }
        } catch (e) { /* ignore */ }
    }
    return false;
}

// ============================== 7. 标定自检 ==============================
function calibrate() {
    if (!ensureCapture()) {
        alert("截图权限获取失败");
        return;
    }
    sleep(1200);
    var img = grabImage();
    if (!img) {
        alert("截图失败");
        return;
    }
    var W = img.width, H = img.height;
    log("屏幕分辨率: " + W + "x" + H + "  (device=" + device.width + "x" + device.height + ")");

    var dir = pickSaveDir();
    if (!dir) dir = CFG.SAVE_DIR;
    var stamp = "" + Date.now();
    var full = dir + "calib_full_" + stamp + ".png";
    try {
        images.save(img, full, "png", 100);
    } catch (e) {
        try { img.saveTo(full); } catch (e2) { log("保存失败: " + e2); }
    }
    log("已保存全屏截图: " + full);

    var rect = findBodyRect(img);
    if (rect) {
        log("自动定位红包主体: x=" + rect.x + " y=" + rect.y + " w=" + rect.w + " h=" + rect.h);
        log("归一化(可直接填 CFG.BODY_NORM): {x:" + (rect.x / W).toFixed(4) +
            ", y:" + (rect.y / H).toFixed(4) + ", w:" + (rect.w / W).toFixed(4) +
            ", h:" + (rect.h / H).toFixed(4) + "}");
        var s = sampleRect(img, rect);
        log("该区域颜色统计: 红=" + s.red + " 金=" + s.gold + " 其他=" + s.none + " => " + verdictOf(s));
    } else {
        log("自动定位失败：请把 " + full + " 发给我人工标定");
    }
    try { img.recycle(); } catch (e) { /* ignore */ }
    saveLog();
}

// ============================== 8. 日志落盘 ==============================
// 旧机/新系统上 /sdcard 根目录可能不可写：探测后回退到脚本所在目录
var SAVE_DIR_CACHE = null;
function pickSaveDir() {
    if (SAVE_DIR_CACHE !== null) return SAVE_DIR_CACHE;
    var cands = [CFG.SAVE_DIR, "/storage/emulated/0/脚本/", "/sdcard/脚本/"];
    var i, probe;
    for (i = 0; i < cands.length; i++) {
        try {
            files.ensureDir(cands[i]);
            probe = cands[i] + ".write_probe";
            files.write(probe, "ok");
            files.remove(probe);
            SAVE_DIR_CACHE = cands[i];
            return SAVE_DIR_CACHE;
        } catch (e) { /* 试下一个目录 */ }
    }
    SAVE_DIR_CACHE = "";
    return SAVE_DIR_CACHE;
}

function saveLog() {
    try {
        var dir = pickSaveDir();
        if (!dir) return;
        var p = dir + "log_" + Date.now() + ".txt";
        files.write(p, logLines.join("\n"));
        log("日志已保存: " + p);
    } catch (e) { /* ignore */ }
}

// ============================== 9. 主流程 ==============================
function main() {
    log("=== 抖音极速版自动刷视频 启动 ===");
    if (MODE === "calibrate") {
        calibrate();
        return;
    }

    if (!ensureCapture()) {
        alert("截图权限获取失败，请允许录屏/截图权限后重试");
        return;
    }

    events.observeKey();
    events.onKeyDown("volume_up", function () {
        STOP = true;
        toast("音量上键：准备停止");
    });

    // 1) 用「第一帧截图的真实宽高」换算采样区（比 device.width 可靠）
    var baseImg = grabImage();
    var baseW = baseImg ? baseImg.width : 0;
    var baseH = baseImg ? baseImg.height : 0;
    if (baseW && baseH) {
        log("截图尺寸: " + baseW + "x" + baseH + "   device=" + device.width + "x" + device.height);
        if (baseW !== device.width || baseH !== device.height) {
            log("  注意：两者不一致，已按截图尺寸换算采样区");
        }
    }

    var rect = resolveRect(baseW, baseH);
    if (!rect) {
        log("未配置采样区，启动自动搜索定位…");
        if (baseImg) rect = findBodyRect(baseImg);
        if (!rect) {
            if (baseImg) { try { baseImg.recycle(); } catch (e) { /* ignore */ } }
            alert("未找到红包挂件，请确认抖音极速版的红包挂件已显示，或先用 MODE=calibrate 标定");
            return;
        }
        log("自动定位成功: x=" + rect.x + " y=" + rect.y + " w=" + rect.w + " h=" + rect.h);
    }
    if (baseImg) {
        try { baseImg.recycle(); } catch (e) { /* ignore */ }
        baseImg = null;
    }
    log("红包主体采样区: " + JSON.stringify(rect));

    var tStart = Date.now();
    var swipedSinceLocate = 0;
    var verified = false;
    var notTarget = 0;
    var redStreak = 0;

    while (!STOP) {
        // 0) 息屏 / 不在抖音极速版前台 -> 暂停，避免在别的界面乱滑
        if (CFG.GUARD_ENABLED) {
            var screenOn = true;
            try { screenOn = device.isScreenOn(); } catch (eS) { /* ignore */ }
            if (!screenOn) {
                log("息屏中，等待亮屏…");
                sleep(3000);
                continue;
            }
            var pkg = "";
            try { pkg = currentPackage(); } catch (eP) { /* ignore */ }
            if (pkg && pkg !== CFG.TARGET_PKG) {
                notTarget++;
                if (notTarget >= CFG.GUARD_RETRY) {
                    log("当前前台是 " + pkg + "，不是抖音极速版，暂停等待…");
                    notTarget = 0;
                    sleep(3000);
                    continue;
                }
            } else {
                notTarget = 0;
            }
        }

        // 首次确认确实在抖音界面里，再做采样区自检
        if (!verified) {
            verifyRect(rect);
            verified = true;
        }

        // 停止条件
        if (CFG.MAX_VIDEOS > 0 && stats.videos >= CFG.MAX_VIDEOS) {
            log("达到视频数上限");
            break;
        }
        if (CFG.MAX_MINUTES > 0 && (Date.now() - tStart) / 60000 >= CFG.MAX_MINUTES) {
            log("达到时间上限");
            break;
        }

        // 定期重新定位（挂件位置漂移时兜底）
        if (CFG.RELOCATE_EVERY > 0 && swipedSinceLocate >= CFG.RELOCATE_EVERY) {
            var imgR = grabImage();
            if (imgR) {
                var found = findBodyRect(imgR);
                try { imgR.recycle(); } catch (e) { /* ignore */ }
                if (found) {
                    rect = found;
                    log("重新定位: " + JSON.stringify(rect));
                }
            }
            swipedSinceLocate = 0;
        }

        stats.videos++;
        var t0 = Date.now();
        log("--- 第 " + stats.videos + " 个视频 ---");
        sleep(CFG.START_GRACE_MS + randInt(0, 600));

        var stable = null, hits = 0, reason = null, liked = false;
        var elapsed, v;

        while (!STOP) {
            elapsed = Date.now() - t0;
            if (elapsed >= CFG.MAX_WATCH_MS) {
                reason = "TIMEOUT";
                stats.goldTimeout++;
                break;
            }

            v = sampleVerdict(rect);
            if (v === stable) {
                hits++;
            } else {
                stable = v;
                hits = 1;
            }

            if (hits >= CFG.STABLE_HITS) {
                if (v === "RED") {
                    reason = "RED";
                    stats.red++;
                    break;
                }
                if (v === "GOLD") {
                    if (CFG.LIKE_ON_GOLD && !liked) {
                        sleep(CFG.LIKE_DELAY_MS);
                        doubleTapLike();
                        liked = true;
                    }
                    // 金色：继续看，等它变红
                } else if (v === "NO_WIDGET") {
                    if (elapsed > CFG.NOWIDGET_GRACE_MS) {
                        reason = "NO_WIDGET";
                        stats.noWidget++;
                        break;
                    }
                } else { // UNKNOWN
                    stats.unknown++;
                    if (elapsed > CFG.NOWIDGET_GRACE_MS) tryClosePopup();
                }
            }
            sleep(CFG.POLL_MS);
        }

        if (STOP) break;
        log("  切下一个（原因: " + reason + "，停留 " + ((Date.now() - t0) / 1000).toFixed(1) + "s）");
        swipeNext();
        swipedSinceLocate++;

        // 护栏：连续多次「红包已结束」且都是秒滑，插一次较长停顿
        if (reason === "RED" && (Date.now() - t0) < 6000) {
            redStreak++;
        } else {
            redStreak = 0;
        }
        if (CFG.RED_STREAK_PAUSE_AFTER > 0 && redStreak >= CFG.RED_STREAK_PAUSE_AFTER) {
            log("  连续 " + redStreak + " 个红包已结束，停顿 " + CFG.RED_STREAK_PAUSE_MS + "ms");
            sleep(CFG.RED_STREAK_PAUSE_MS);
            redStreak = 0;
        }
    }

    log("=== 结束 ===");
    log("统计: 视频=" + stats.videos + " 红包已结束(红)=" + stats.red +
        " 金色超时=" + stats.goldTimeout + " 无挂件=" + stats.noWidget +
        " 未知=" + stats.unknown + " 点赞=" + stats.likes +
        " 用时=" + ((Date.now() - tStart) / 60000).toFixed(1) + " 分钟");
    saveLog();
    toast("脚本已停止，统计已写入日志");
}

// ============================== 启动 ==============================
try {
    // 无障碍服务（swipe/click 需要）；未开启时 AutoJs6 会跳到设置页等待
    try {
        if (!auto.service) toast("请先开启 AutoJs6 的无障碍服务，否则无法滑动");
    } catch (e0) { /* ignore */ }
    auto.waitFor();
    main();
} catch (e) {
    log("发生异常: " + e + "\n" + (e.stack || ""));
    saveLog();
    alert("脚本异常终止: " + e);
}
