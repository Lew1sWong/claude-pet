/* Boss screen renderer — renders four convincing "work" disguises and animates
   the active one. Local triple-Esc dismisses (belt-and-suspenders with the
   main-process global hook). */
(function () {
  "use strict";
  const api = window.petAPI;

  const sections = {
    terminal: document.getElementById("dg-terminal"),
    excel: document.getElementById("dg-excel"),
    word: document.getElementById("dg-word"),
    code: document.getElementById("dg-code"),
  };
  const hint = document.getElementById("boss-hint");

  // ───────────────────────── Terminal ─────────────────────────
  const termOut = document.getElementById("term-out");
  const TERM_SCRIPT = [
    { t: '<span class="p">~/work/claude-pet</span> <span class="c">npm run build</span>' },
    { t: '<span class="dim">&gt; claude-pet@1.4.0 build</span>' },
    { t: '<span class="dim">&gt; webpack --mode production</span>' },
    { t: '' },
    { t: 'asset <span class="c">main.[hash].js</span> 1.42 MiB [emitted] [minimized] (name: main)' },
    { t: 'asset <span class="c">vendor.[hash].js</span> 318 KiB [emitted] [minimized]' },
    { t: 'orphan modules 612 KiB [orphan] 184 modules' },
    { t: 'runtime modules 27.3 KiB 14 modules' },
    { t: '<span class="ok">webpack 5.94.0 compiled successfully in 8423 ms</span>' },
    { t: '' },
    { t: '<span class="p">~/work/claude-pet</span> <span class="c">npm test -- --coverage</span>' },
    { t: '<span class="ok">PASS</span> <span class="dim">src/lib/usageClient.test.ts</span>' },
    { t: '<span class="ok">PASS</span> <span class="dim">src/lib/credentials.test.ts</span>' },
    { t: '<span class="ok">PASS</span> <span class="dim">src/renderer/petcore.test.ts</span>' },
    { t: '<span class="warn">RUNS</span> <span class="dim">src/renderer/island.test.ts</span>' },
    { t: '<span class="ok">PASS</span> <span class="dim">src/renderer/island.test.ts</span>' },
    { t: '' },
    { t: 'Test Suites: <span class="ok">12 passed</span>, 12 total' },
    { t: 'Tests:       <span class="ok">147 passed</span>, 147 total' },
    { t: 'Coverage:    <span class="ok">94.2%</span> statements' },
    { t: 'Time:        12.8 s' },
    { t: '' },
    { t: '<span class="p">~/work/claude-pet</span> <span class="c">git status</span>' },
    { t: 'On branch <span class="ty">main</span>' },
    { t: "Your branch is up to date with 'origin/main'." },
    { t: '<span class="dim">nothing to commit, working tree clean</span>' },
    { t: '' },
    { t: '<span class="p">~/work/claude-pet</span> <span class="c">npm run deploy:staging</span>' },
    { t: '<span class="dim">⠋ building image…</span>' },
    { t: '<span class="dim">⠙ pushing to registry…</span>' },
    { t: '<span class="ok">✓ deployed to staging (rev 4f2a9c1)</span>' },
    { t: '' },
  ];
  let termTimer = null;
  let termIdx = 0;
  function termStart() {
    termStop();
    const step = () => {
      const line = TERM_SCRIPT[termIdx % TERM_SCRIPT.length];
      const div = document.createElement("div");
      div.className = "term-line";
      div.innerHTML = line.t || "&nbsp;";
      termOut.appendChild(div);
      while (termOut.childElementCount > 44) termOut.removeChild(termOut.firstChild);
      termIdx++;
      const blank = !line.t;
      termTimer = setTimeout(step, blank ? 260 : 120 + Math.random() * 340);
    };
    step();
  }
  function termStop() { if (termTimer) { clearTimeout(termTimer); termTimer = null; } }

  // ───────────────────────── Excel ─────────────────────────
  function buildExcel() {
    const grid = document.getElementById("xl-grid");
    if (grid.dataset.built) return;
    grid.dataset.built = "1";
    const COLS = 14, ROWS = 40;
    const letters = Array.from({ length: COLS }, (_, i) => String.fromCharCode(65 + i));
    const heads = ["序号", "部门", "项目", "预算(¥)", "已用(¥)", "余额(¥)", "占比", "负责人", "状态", "月份", "Q1", "Q2", "合计", "备注"];
    const depts = ["研发部", "市场部", "运营部", "财务部", "销售部", "人事部", "客服部"];
    const projs = ["平台重构", "新品推广", "渠道拓展", "年度审计", "客户回访", "招聘扩编", "系统升级"];
    const owners = ["张伟", "李娜", "王芳", "刘洋", "陈静", "赵磊", "孙倩"];
    const states = ["进行中", "已完成", "待审批", "延期", "正常"];
    const numCols = new Set([3, 4, 5, 10, 11, 12]);
    const fmt = (n) => n.toLocaleString("en-US");
    let html = "<tr><th class='rowh'></th>" + letters.map((l) => `<th>${l}</th>`).join("") + "</tr>";
    html += "<tr><td class='rowh'>1</td>" + heads.map((h) => `<td class='head'>${h}</td>`).join("") + "</tr>";
    for (let r = 2; r <= ROWS; r++) {
      const budget = 8000 + Math.floor(Math.random() * 90000);
      const used = Math.floor(budget * (0.3 + Math.random() * 0.65));
      const q1 = Math.floor(used * (0.4 + Math.random() * 0.2));
      const cells = [
        r - 1,
        depts[(r) % depts.length],
        projs[(r * 3) % projs.length],
        fmt(budget), fmt(used), fmt(budget - used),
        Math.round((used / budget) * 100) + "%",
        owners[(r * 5) % owners.length],
        states[(r * 2) % states.length],
        ((r % 6) + 1) + "月",
        fmt(q1), fmt(used - q1), fmt(used),
        r % 7 === 0 ? "需复核" : "—",
      ];
      html += "<tr><td class='rowh'>" + r + "</td>" +
        cells.map((c, i) => `<td class="${numCols.has(i) ? "num" : ""} ${r === 12 && i === 5 ? "sel" : ""}">${c}</td>`).join("") +
        "</tr>";
    }
    grid.innerHTML = html;
  }

  // ───────────────────────── Word ─────────────────────────
  function buildWord() {
    const page = document.getElementById("wd-page");
    if (page.dataset.built) return;
    page.dataset.built = "1";
    page.innerHTML = `
      <h1>项目周报</h1>
      <div class="sub">第 24 周 · 产品研发中心 · 2026/06/15 – 06/21</div>
      <h2>一、本周工作总结</h2>
      <p>本周围绕核心模块的稳定性与体验优化展开工作，完成了既定迭代目标的 92%。研发团队针对上线后反馈的若干问题进行了集中排查与修复，整体系统可用性较上周提升明显，关键链路的平均响应时间下降约 18%。</p>
      <p>在跨部门协作方面，已与市场、运营两个团队完成下季度推广节奏的对齐，相关排期与资源需求已同步至项目看板，待管理层评审后进入执行阶段。</p>
      <h2>二、关键进展</h2>
      <p>1. 完成数据采集链路的重构，吞吐能力提升约 1.6 倍，并补齐了端到端的监控与告警；<br>2. 新版交互方案通过内部可用性测试，用户满意度评分由 4.1 提升至 4.6；<br>3. 自动化测试覆盖率提升至 94.2%，回归用例全部通过。</p>
      <h2>三、下周计划</h2>
      <p>下周将重点推进灰度发布与性能压测，目标在周五前完成全量上线前的最后一轮验证；同时启动下一迭代的需求评审，确保排期顺利衔接。<span class="wd-caret">&nbsp;</span></p>
    `;
  }

  // ───────────────────────── VS Code ─────────────────────────
  function buildCode() {
    const tree = document.getElementById("vs-tree");
    const code = document.getElementById("vs-code");
    if (tree.dataset.built) return;
    tree.dataset.built = "1";
    tree.innerHTML = `
      <div class="row dir">▾ src</div>
      <div class="row dir ind">▾ lib</div>
      <div class="row ind active">　usageClient.ts</div>
      <div class="row ind">　credentials.ts</div>
      <div class="row dir ind">▾ renderer</div>
      <div class="row ind">　pet.tsx</div>
      <div class="row ind">　island.tsx</div>
      <div class="row ind">　petcore.ts</div>
      <div class="row dir">▸ test</div>
      <div class="row">　package.json</div>
      <div class="row">　tsconfig.json</div>
      <div class="row">　README.md</div>`;
    code.innerHTML =
`<span class="com">// usageClient.ts — fetch &amp; normalize Claude usage</span>
<span class="kw">import</span> { <span class="var">request</span> } <span class="kw">from</span> <span class="str">"./http"</span>;

<span class="kw">const</span> <span class="var">ENDPOINT</span> = <span class="str">"https://api.anthropic.com/api/oauth/usage"</span>;

<span class="kw">export async function</span> <span class="fn">fetchUsage</span>(<span class="var">token</span>: <span class="ty">string</span>): <span class="ty">Promise</span>&lt;<span class="ty">Usage</span>&gt; {
  <span class="kw">const</span> <span class="var">res</span> = <span class="kw">await</span> <span class="fn">request</span>(<span class="var">ENDPOINT</span>, {
    <span class="var">headers</span>: {
      <span class="var">Authorization</span>: <span class="str">\`Bearer \${token}\`</span>,
      <span class="str">"anthropic-beta"</span>: <span class="str">"oauth-2025-04-20"</span>,
    },
  });
  <span class="kw">if</span> (<span class="var">res</span>.<span class="var">status</span> === <span class="num">429</span>) <span class="kw">throw new</span> <span class="ty">RateLimit</span>(<span class="var">res</span>);
  <span class="kw">const</span> <span class="var">data</span> = <span class="kw">await</span> <span class="var">res</span>.<span class="fn">json</span>();
  <span class="kw">return</span> {
    <span class="var">fiveHour</span>: <span class="fn">pct</span>(<span class="var">data</span>.<span class="var">five_hour</span>),
    <span class="var">week</span>: <span class="fn">pct</span>(<span class="var">data</span>.<span class="var">seven_day</span>),
  };<span class="vs-caret"></span>
}`;
  }

  // ───────────────────────── show / hide ─────────────────────────
  function showDisguise(which) {
    Object.values(sections).forEach((s) => s.classList.remove("show"));
    termStop();
    const sec = sections[which] || sections.terminal;
    if (which === "excel") buildExcel();
    else if (which === "word") buildWord();
    else if (which === "code") buildCode();
    sec.classList.add("show");
    if (sec === sections.terminal) { termOut.innerHTML = ""; termIdx = 0; termStart(); }
    // brief reminder of how to leave
    hint.classList.add("flash");
    setTimeout(() => hint.classList.remove("flash"), 2600);
  }

  let escNeed = 3, escWin = 650;
  api.onBossShow((d) => {
    if (d && Number.isFinite(d.escCount) && d.escCount >= 2) escNeed = d.escCount;
    if (d && Number.isFinite(d.escWindow) && d.escWindow >= 200) escWin = d.escWindow;
    if (d && d.exitHint) hint.textContent = d.exitHint;
    showDisguise((d && d.disguise) || "terminal");
  });

  // the boss window keeps timers running while hidden (backgroundThrottling:false),
  // so stop the terminal animation when it's dismissed; next show restarts it
  document.addEventListener("visibilitychange", () => { if (document.hidden) termStop(); });

  // local triple-Esc fallback (works once this window is focused even without the
  // global Accessibility hook); honors the configured count / window
  let escTimes = [];
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const now = performance.now();
    escTimes.push(now);
    escTimes = escTimes.filter((t) => now - t <= escWin);
    if (escTimes.length >= escNeed) { escTimes = []; api.bossDismiss(); }
  });
})();
