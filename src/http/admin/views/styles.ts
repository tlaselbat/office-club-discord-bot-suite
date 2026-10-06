export const panelCss = `:root{
  font-family:system-ui,sans-serif;
  color:#e8edf4;
  background:#0d1117
}
body{margin:0}
main{max-width:1050px;margin:auto;padding:2rem}
.site-header{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:1rem;
  flex-wrap:wrap;
  margin:1rem 0
}
.brand h1{font-size:1.25rem;margin:0}
.brand p{margin:.25rem 0 0;color:#8b949e}
.module-nav{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:.75rem 1rem;margin:1rem 0}
.module-nav ul{display:flex;gap:1.25rem;list-style:none;margin:0;padding:0;flex-wrap:wrap}
.module-nav a{text-decoration:none;color:#8b949e}
.module-nav a[aria-current="page"],.module-nav a:hover{color:#58a6ff}
.guild-back{margin:.5rem 0;color:#8b949e}
.card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1.25rem;margin:1rem 0}
.card h2{margin-top:0;font-size:1.1rem}
.narrow{max-width:32rem;margin:15vh auto}
form{display:grid;gap:1rem}
label{display:grid;gap:.35rem}
.field{margin-bottom:.5rem}
.hint{font-size:.85rem;color:#8b949e;margin:.15rem 0}
input,select,button,.button{font:inherit;color:inherit;background:#21262d;border:1px solid #484f58;border-radius:6px;padding:.65rem}
.button{display:inline-block;text-decoration:none}
button,.button{cursor:pointer;width:max-content}
button:disabled,.button.disabled{opacity:.5;cursor:not-allowed}
button:focus,a:focus,input:focus,select:focus{outline:3px solid #58a6ff;outline-offset:2px}
select[multiple]{min-height:8rem}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:.75rem;border-bottom:1px solid #30363d}
a{color:#58a6ff}
.notice{background:#16351f;padding:1rem;border-radius:6px}
.notice.warning{background:#341a16}
.notice.error{background:#34131c}
.warning,.bad,.error-summary{color:#ffb4a8}
.ok,.notice{color:#7ee787}
.empty{color:#8b949e;font-style:italic}
.error-summary{background:#34131c;padding:1rem;border-radius:6px}
.error-summary h2{margin-top:0;font-size:1rem}
.field-error{display:block;color:#ffb4a8;font-size:.85rem}
.badge{display:inline-block;padding:.25rem .5rem;border-radius:999px;font-size:.8rem;font-weight:600}
.badge.production-ready,.badge.enabled,.badge.online{background:#16351f;color:#7ee787}
.badge.in-development,.badge.disabled,.badge.offline{background:#21262d;color:#8b949e}
.badge.needs-attention,.badge.degraded{background:#341a16;color:#f0b232}
.badge.unconfigured,.badge.unavailable{background:#34131c;color:#ffb4a8}
.dl{display:grid;grid-template-columns:auto 1fr;gap:.25rem 1rem}
.dl dt{color:#8b949e}
.dl dd{margin:0}
.actions{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;margin-top:.75rem}
.read-only{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:.75rem}
.read-only p{margin:.25rem 0}
@media(max-width:650px){
  main{padding:1rem}
  .site-header,.actions{align-items:stretch;flex-direction:column}
  .card{overflow:auto}
  .module-nav ul{gap:.75rem}
  .dl{grid-template-columns:1fr}
}`;
