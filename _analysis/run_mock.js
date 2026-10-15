/**
 * 在 Node 里模拟 AutoJs6 运行环境，用真实截图像素喂给真脚本，端到端验证：
 *   金色 -> 继续看 + 点赞 ; 红色 -> 上滑 ; 已点赞不重复 ; 无 ReferenceError
 * 用法: node run_mock.js
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const frames = JSON.parse(fs.readFileSync(path.join(HERE, 'frames.json'), 'utf8'));
const RAW = fs.readFileSync(path.join(ROOT, 'douyin_lite_auto.js'), 'utf8');

/* ---------- 虚拟时钟：sleep 直接推进时间，60s 超时瞬间走完 ---------- */
let vnow = 1700000000000;
class FakeDate extends Date {
    constructor() {
        if (arguments.length === 0) super(vnow);
        else super(...arguments);
    }
    static now() { return vnow; }
}

class Stop extends Error {}

function run(mode, opts) {
    opts = opts || {};
    const logs = [], swipes = [], clicks = [], alerts = [], toasts = [], swipeTimes = [];
    let videoStart = vnow;
    const t0 = vnow;
    const TIME_LIMIT = 15 * 60 * 1000;      // 虚拟时间上限，防止死循环用例挂住
    const GOLD_MS = opts.goldMs === undefined ? 3000 : opts.goldMs;
    const MAX_SWIPES = opts.maxSwipes === undefined ? 3 : opts.maxSwipes;

    function stateNow() { return (vnow - videoStart < GOLD_MS) ? 'gold' : 'red'; }

    function makeImage(state) {
        const f = frames[state];
        const r = f.rect;
        return {
            width: f.w,
            height: f.h,
            pixel: function (x, y) {
                const px = Math.floor(x), py = Math.floor(y);
                if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) {
                    const ix = Math.floor((px - r.x) / f.step);
                    const iy = Math.floor((py - r.y) / f.step);
                    if (iy >= 0 && iy < f.grid.length && ix >= 0 && ix < f.grid[iy].length) {
                        const p = f.grid[iy][ix];
                        return ((0xff << 24) | (p[0] << 16) | (p[1] << 8) | p[2]) >>> 0;
                    }
                }
                return 0xff101010;   // 视频/背景区域：深色 -> NONE
            },
            recycle: function () {}
        };
    }

    const sandbox = {
        console: { log: function (m) { logs.push(String(m)); } },
        Date: FakeDate,
        device: { width: 1080, height: 2400, isScreenOn: function () { return opts.screenOn !== false; } },
        auto: { service: {}, waitFor: function () {} },
        requestScreenCapture: function () { return true; },
        captureScreen: function () { return makeImage(stateNow()); },
        images: {
            requestScreenCapture: function () { return true; },
            captureScreen: function () { return makeImage(stateNow()); },
            pixel: function (img, x, y) { return img.pixel(x, y); },
            save: function () { return true; }
        },
        sleep: function (ms) {
            vnow += (ms > 0 ? ms : 0);
            if (vnow - t0 > TIME_LIMIT) throw new Stop('virtual-time-limit');
        },
        swipe: function (x1, y1, x2, y2, d) {
            swipes.push([x1, y1, x2, y2, d]);
            swipeTimes.push(vnow);
            videoStart = vnow;
            if (swipes.length >= MAX_SWIPES) throw new Stop('swipe-limit-reached');
        },
        click: function (x, y) { clicks.push([x, y]); },
        toast: function (m) { toasts.push(String(m)); },
        alert: function (m) { alerts.push(String(m)); throw new Stop('alert:' + m); },
        events: { observeKey: function () {}, onKeyDown: function () {} },
        textContains: function () { return { findOnce: function () { return null; } }; },
        currentPackage: function () { return opts.pkg || 'com.ss.android.ugc.aweme.lite'; },
        files: { ensureDir: function () {}, write: function () {}, remove: function () {} },
        runtime: {},
        engines: {}
    };
    sandbox.global = sandbox;
    vm.createContext(sandbox);

    const src = RAW.replace('var MODE = "run";', 'var MODE = "' + mode + '";');
    let thrown = null;
    try {
        vm.runInContext(src, sandbox, { filename: 'douyin_lite_auto.js' });
    } catch (e) {
        thrown = e;
    }
    return { logs, swipes, clicks, alerts, toasts, thrown, swipeTimes };
}

/** 相邻两次滑动之间的虚拟耗时 = 一个视频的完整周期（不含真实截图耗时） */
function cycle(times) {
    if (times.length < 2) return { avg: NaN, list: [] };
    const list = [];
    for (let i = 1; i < times.length; i++) list.push((times[i] - times[i - 1]) / 1000);
    return { avg: list.reduce(function (a, b) { return a + b; }, 0) / list.length, list };
}

/* ============================ 用例 1：正常刷 ============================ */
console.log('================ 用例 1：金色 3 秒后变红，刷 3 个视频 ================');
const r1 = run('run');
r1.logs.forEach(function (l) { console.log('  ' + l); });
console.log('  [harness] swipe 次数=' + r1.swipes.length + '  click 次数=' + r1.clicks.length +
            '  alert=' + JSON.stringify(r1.alerts));
const c1 = cycle(r1.swipeTimes);
console.log('  [harness] 每个视频周期(虚拟时钟): 平均 ' + c1.avg.toFixed(2) + 's   逐个=' +
            c1.list.map(function (x) { return x.toFixed(2); }).join(' / ') + 's');

const joined = r1.logs.join('\n');
const checks = [];
checks.push(['出现了 GOLD 判定', /=> GOLD/.test(joined)]);
checks.push(['出现了 RED 判定', /=> RED/.test(joined)]);
checks.push(['金色时点了赞（双击=2 次 click）', r1.clicks.length >= 2]);
checks.push(['点赞点位于视频区中部', r1.clicks.length > 0 && r1.clicks[0][0] === 540 && r1.clicks[0][1] === 1008]);
checks.push(['至少上滑一次', r1.swipes.length >= 1]);
checks.push(['滑动方向向上且落在配置范围内',
    r1.swipes.length > 0 && r1.swipes[0][1] > r1.swipes[0][3] && r1.swipes[0][1] === 1872 && r1.swipes[0][3] === 600]);
checks.push(['切下一个的原因含 RED', /切下一个（原因: RED/.test(joined)]);
checks.push(['启动自检通过了采样区', /启动自检：红=\d+ 金=\d+/.test(joined) && !/\[警告\]/.test(joined)]);
checks.push(['无 ReferenceError / 未定义', !/ReferenceError|is not defined|未定义/.test(joined)]);
checks.push(['无 NaN', !/NaN/.test(joined)]);
checks.push(['结束时是被 harness 掐断而非脚本自身异常',
    /swipe-limit-reached/.test(String(r1.thrown && r1.thrown.message))]);

/* ============================ 用例 2：一直金色 ============================ */
console.log('\n================ 用例 2：红包一直金色（不该被滑走，应超时兜底）================');
const r2 = run('run', { goldMs: 999999, maxSwipes: 1 });
const j2 = r2.logs.join('\n');
console.log('  判定次数=' + (j2.match(/=> GOLD/g) || []).length +
            '  超时兜底=' + /原因: TIMEOUT/.test(j2) + '  点赞次数=' + Math.floor(r2.clicks.length / 2));
checks.push(['一直金色时只点赞 1 次（同一视频不重复点赞）', r2.clicks.length === 2]);
checks.push(['一直金色最后按 TIMEOUT 兜底滑走', /原因: TIMEOUT/.test(j2)]);
checks.push(['金色视频停留接近 60s 上限', /停留 6[0-9]\.\d+s/.test(j2)]);

/* ============================ 用例 3：一进就是红色 ============================ */
console.log('\n================ 用例 3：一进视频就是红色（应该很快滑走）================');
const r3 = run('run', { goldMs: 0, maxSwipes: 8 });
const j3 = r3.logs.join('\n');
const c3 = cycle(r3.swipeTimes);
console.log('  全红场景每个视频周期: 平均 ' + c3.avg.toFixed(2) + 's   逐个=' +
            c3.list.map(function (x) { return x.toFixed(2); }).join(' / ') + 's');
console.log('  swipe 次数=' + r3.swipes.length + '  click 次数=' + r3.clicks.length);
checks.push(['红色视频不点赞', r3.clicks.length === 0]);
checks.push(['红色视频很快滑走（5 秒内）', /原因: RED/.test(j3) && /停留 [0-4]\.\d+s/.test(j3)]);
checks.push(['极速档周期 < 4s', c3.avg < 4.0]);
checks.push(['连续 6 个秒滑后真的插入了 4000ms 停顿', /停顿 4000ms/.test(j3)]);

/* ============================ 用例 4：息屏 / 不在前台 ============================ */
console.log('\n================ 用例 4：不在抖音前台（应暂停而不是乱滑）================');
const r4 = run('run', { pkg: 'com.android.settings', maxSwipes: 1 });
const j4 = r4.logs.join('\n');
console.log('  日志前 4 行: ' + JSON.stringify(r4.logs.slice(0, 4)));
console.log('  swipe 次数=' + r4.swipes.length + '  暂停日志出现次数=' + (j4.match(/暂停等待/g) || []).length);
checks.push(['检测到不在前台并暂停', /不是抖音极速版，暂停等待/.test(j4)]);
checks.push(['暂停期间没有滑动', r4.swipes.length === 0]);

/* ============================ 用例 5：标定模式 ============================ */
console.log('\n================ 用例 5：MODE=calibrate 标定模式 ================');
const r5 = run('calibrate');
const j5 = r5.logs.join('\n');
r5.logs.forEach(function (l) { console.log('  ' + l); });
checks.push(['标定模式跑通且未抛异常', r5.thrown === null]);
checks.push(['能自动定位到挂件', /自动定位红包主体: x=/.test(j5)]);
checks.push(['算出的归一化坐标与原标定接近',
    (function () {
        const m = j5.match(/归一化\(可直接填 CFG\.BODY_NORM\): \{x:([\d.]+), y:([\d.]+), w:([\d.]+), h:([\d.]+)\}/);
        if (!m) return false;
        return Math.abs(parseFloat(m[1]) - 0.853) < 0.04 && Math.abs(parseFloat(m[2]) - 0.177) < 0.04;
    })()]);

/* ============================ 汇总 ============================ */
console.log('\n================ 断言汇总 ================');
let fail = 0;
checks.forEach(function (c) {
    console.log('  [' + (c[1] ? 'PASS' : 'FAIL') + '] ' + c[0]);
    if (!c[1]) fail++;
});
console.log('\n' + (fail === 0 ? '全部 ' + checks.length + ' 项断言通过' : fail + ' / ' + checks.length + ' 项失败'));
process.exit(fail === 0 ? 0 : 1);
