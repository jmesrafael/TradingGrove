// analytics.js - analytics page
// Loaded by /src/pages/analytics.html. Depends on globals from supabase-client.js.
const jid = sessionStorage.getItem('tz_current_journal')||localStorage.getItem('tz_current_journal')||(()=>{try{return parent?.sessionStorage?.getItem('tz_current_journal')||parent?.localStorage?.getItem('tz_current_journal');}catch(e){return null;}})();

const G='#19c37d', R='#f05165', Y='#f5c518';

let _anaQueuedReload=false,_anaReloadTimer=null,_anaTabActive=false;
function _anaMaybeReload(){
  if(!_anaQueuedReload||!_anaTabActive||document.visibilityState==='hidden')return;
  clearTimeout(_anaReloadTimer);_anaReloadTimer=setTimeout(()=>location.reload(),300);
}
window.addEventListener('message',e=>{
  if(e.data?.type==='tz_trades_changed'){_anaQueuedReload=true;_anaMaybeReload();}
  if(e.data?.type==='tz_tab_changed'){_anaTabActive=(e.data.tab==='analytics');if(_anaTabActive)_anaMaybeReload();}
});
document.addEventListener('visibilitychange',_anaMaybeReload);

function fP(v){const n=parseFloat(v);if(isNaN(n))return'0.00';return(n>=0?'+':'-')+'$'+Math.abs(n).toFixed(2);}
function fPct(v){return parseFloat(v).toFixed(1)+'%';}
function grc(n){return n>0?G:n<0?R:'var(--muted)';}
function wrColor(wr){return wr>=50?G:wr>=35?Y:R;}
function fH(h){if(h===0)return'12 AM';if(h===12)return'12 PM';return h<12?h+' AM':(h-12)+' PM';}
function fHs(h){if(h===0)return'12AM';if(h===12)return'12PM';return h<12?h+'AM':(h-12)+'PM';}
function secHdr(icon,title,tip,right=''){
  const t=tip?`<span class="sec-tip" data-tip="${tip}">?</span>`:'';
  return `<div class="sec-hdr"><div class="sec-hdr-l"><span class="sec-ico"><i class="fa-solid ${icon}"></i></span><span class="sec-ttl">${title}</span>${t}</div>${right}</div>`;
}

function wrBarHtml(wr){
  const color=wr>=50?G:wr>=35?Y:R;
  const w=Math.min(Math.max(wr,0),100);
  return`<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:4px;background:var(--border2,#253127);border-radius:3px"><div style="height:4px;width:${w.toFixed(0)}%;background:${color};border-radius:3px"></div></div><span style="font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;color:${color};min-width:34px">${w.toFixed(0)}%</span></div>`;
}

function computeStats(trades){
  const vld=trades.filter(t=>t.pnl!==''&&!isNaN(parseFloat(t.pnl))).map(t=>({...t,pnl:parseFloat(t.pnl)}));
  const wins=vld.filter(t=>t.pnl>0),losses=vld.filter(t=>t.pnl<0),be=vld.filter(t=>t.pnl===0);
  const total=vld.reduce((s,t)=>s+t.pnl,0);
  const wr=vld.length?(wins.length/vld.length)*100:0;
  const totalW=wins.reduce((s,t)=>s+t.pnl,0);
  const totalL=Math.abs(losses.reduce((s,t)=>s+t.pnl,0));
  const pf=totalL>0?totalW/totalL:wins.length>0?999:0;
  const avgWin=wins.length?totalW/wins.length:0;
  const avgLoss=losses.length?totalL/losses.length:0;
  const sorted=[...vld].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  let peak=0,eq=0,maxDd=0;
  sorted.forEach(t=>{eq+=t.pnl;if(eq>peak)peak=eq;const dd=peak-eq;if(dd>maxDd)maxDd=dd;});
  let cW=0,cL=0,mxW=0,mxL=0;
  sorted.forEach(t=>{
    if(t.pnl>0){cW++;cL=0;mxW=Math.max(mxW,cW);}
    else if(t.pnl<0){cL++;cW=0;mxL=Math.max(mxL,cL);}
    else{cW=0;cL=0;}
  });
  const best=vld.length?Math.max(...vld.map(t=>t.pnl)):0;
  const worst=vld.length?Math.min(...vld.map(t=>t.pnl)):0;
  const rvs=vld.filter(t=>t.r!==undefined&&t.r!==''&&!isNaN(parseFloat(t.r)));
  const avgR=rvs.length?rvs.reduce((s,t)=>s+parseFloat(t.r),0)/rvs.length:0;
  const daily={};
  sorted.forEach(t=>{daily[t.date]=(daily[t.date]||0)+t.pnl;});
  const dpnls=Object.values(daily);
  const mean=dpnls.length?dpnls.reduce((a,b)=>a+b,0)/dpnls.length:0;
  const variance=dpnls.reduce((s,n)=>s+Math.pow(n-mean,2),0)/(dpnls.length||1);
  const std=Math.sqrt(variance);
  const consistency=std===0?1:Math.max(0,1-(std/Math.abs(mean||1)));
  return{vld,wins,losses,be,total,wr,pf,avgWin,avgLoss,maxDd,mxW,mxL,best,worst,avgR,sorted,consistency,daily};
}

function filterByRange(trades,range){
  if(range==='all')return trades;
  const now=new Date(),cutoff=new Date(now);
  if(range==='7d')cutoff.setDate(cutoff.getDate()-7);
  else if(range==='30d')cutoff.setDate(cutoff.getDate()-30);
  else if(range==='90d')cutoff.setDate(cutoff.getDate()-90);
  return trades.filter(t=>new Date((t.date||'')+'T12:00:00')>=cutoff);
}

Chart.register({
  id:'crosshairLine',
  afterDraw(chart){
    if(!chart.options.showCrosshair)return;
    const active=chart.tooltip?._active;if(!active?.length)return;
    const{ctx,chartArea:{top,bottom}}=chart;const x=active[0].element.x;
    ctx.save();ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);
    ctx.lineWidth=1;ctx.strokeStyle='rgba(255,255,255,.13)';ctx.setLineDash([4,4]);ctx.stroke();ctx.restore();
  }
});
Chart.register({
  id:'doughnutCenterText',
  afterDatasetsDraw(chart){
    if(!chart._centerText)return;
    const{ctx,chartArea}=chart;
    const meta=chart.getDatasetMeta(0);
    const{x:cx,y:cy}=meta.data[0]||{x:chartArea.left+chartArea.width/2,y:chartArea.top+chartArea.height/2};
    const textColor=getComputedStyle(document.documentElement).getPropertyValue('--text').trim()||'#dff0e4';
    const mutedColor=getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()||'#6b8f72';
    const bodyFont=getComputedStyle(document.documentElement).getPropertyValue('--font-body').trim()||'Space Grotesk, sans-serif';
    ctx.save();
    ctx.font=`bold 22px ${bodyFont}`;ctx.fillStyle=chart._centerColor||textColor;
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(chart._centerText,cx,cy-6);
    ctx.font=`10px ${bodyFont}`;ctx.fillStyle=mutedColor;ctx.fillText('Win Rate',cx,cy+11);
    ctx.restore();
  }
});

let _charts=[];
function _mkChart(el,cfg){if(!el)return null;const c=new Chart(el,cfg);_charts.push(c);return c;}
function _destroyCharts(){_charts.forEach(c=>c.destroy());_charts=[];window._eqChart=null;}

function _chartDefaults(){
  const rs=getComputedStyle(document.documentElement);
  Chart.defaults.color=rs.getPropertyValue('--muted').trim()||'#6b8f72';
  Chart.defaults.borderColor=rs.getPropertyValue('--border').trim()||'#1e2e1f';
  Chart.defaults.font.family="'Space Grotesk', sans-serif";
}

function _panelColor(){return getComputedStyle(document.documentElement).getPropertyValue('--panel').trim()||'#141f15';}
function _tc(){return getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()||'#6b8f72';}
function _textColor(){return getComputedStyle(document.documentElement).getPropertyValue('--text').trim()||'#dff0e4';}
function _gc(){return getComputedStyle(document.documentElement).getPropertyValue('--border').trim()||'#1e2e1f';}

function _makeEquityChart(canvasId,sorted){
  let acc=0;
  const labels=sorted.map(t=>t.date);
  const data=sorted.map(t=>{acc+=t.pnl;return+acc.toFixed(2);});
  const c=_mkChart(document.getElementById(canvasId),{
    type:'line',
    data:{labels,datasets:[{data,borderColor:G,backgroundColor:G+'14',fill:true,tension:.38,borderWidth:2,pointRadius:0,pointHoverRadius:6,pointBackgroundColor:G}]},
    options:{
      responsive:true,maintainAspectRatio:false,showCrosshair:true,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:false},
        tooltip:{backgroundColor:_panelColor(),borderColor:'rgba(255,255,255,.1)',borderWidth:1,titleColor:_tc(),bodyColor:_textColor(),padding:12,displayColors:false,
          callbacks:{title:ctx=>ctx[0]?.label||'',label:ctx=>{const v=ctx.raw;return(v>=0?'▲ ':'▼ ')+fP(v);}}}
      },
      scales:{
        x:{ticks:{maxTicksLimit:8,font:{size:10}}},
        y:{ticks:{callback:v=>(v>=0?'+':'-')+'$'+Math.abs(v).toFixed(0),font:{size:10}}}
      }
    }
  });
  return c;
}

function renderKpiStrip(stats,container){
  const{total,wr,pf,maxDd,mxW,mxL,vld,wins,losses}=stats;
  const cards=[
    {label:'Net P&L',value:fP(total),color:grc(total),sub:`${vld.length} trade${vld.length!==1?'s':''}`,tip:'Total profit/loss for the selected period'},
    {label:'Win Rate',value:fPct(wr),color:wrColor(wr),sub:`${wins.length}W · ${losses.length}L`,tip:'Percentage of profitable trades'},
    {label:'Profit Factor',value:pf===999?'∞':pf.toFixed(2),color:pf>=1.5?G:pf>=1?Y:R,sub:'gross W ÷ gross L',tip:'Ratio of gross profit to gross loss. >1.5 is strong.'},
    {label:'Max Drawdown',value:maxDd>0?'-$'+maxDd.toFixed(0):'-',color:maxDd>0?R:'var(--muted)',sub:'peak-to-trough',tip:'Largest peak-to-trough equity decline'},
    {label:'Streaks',value:`${mxW}W · ${mxL}L`,color:'var(--text)',sub:'best win / loss run',tip:'Longest consecutive winning and losing streaks'},
  ];
  container.innerHTML=cards.map(k=>`
    <div class="kpi-card">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value" style="color:${k.color}">${k.value}</div>
      <div class="kpi-sub">${k.sub}</div>
      <div class="kpi-tip">${k.tip}</div>
    </div>`).join('');
}

function renderInsightBar(stats,container,isPro){
  const{wr,pf,vld}=stats;
  if(!vld.length){container.innerHTML='';return;}
  if(vld.length<5){container.innerHTML='';return;}
  let msg='',color='var(--muted)';
  if(wr<40){msg=`Win rate ${wr.toFixed(0)}% is below threshold. Review entry criteria.`;color=R;}
  else if(pf<1){msg=`Profit factor ${pf.toFixed(2)}. Losses exceed gains. Widen RR or cut losers faster.`;color=R;}
  else if(wr>58&&pf>1.8){msg=`Strong performance.${wr.toFixed(0)}% WR with ${pf.toFixed(2)} PF. Focus on sizing up.`;color=G;}
  else{msg=`${wr.toFixed(0)}% WR · ${pf.toFixed(2)} PF.stable.${isPro?' See Insights tab for full analysis.':''}`;}
  const btn=isPro?`<button class="insight-view-btn" onclick="window._switchTab('insights')">View Insights →</button>`:'';
  container.innerHTML=`<div class="insight-bar" style="border-left:3px solid ${color}"><span style="font-size:15px">💡</span><span style="color:var(--muted)">${msg}</span>${btn}</div>`;
}

// Layout changes vs original:
//  • Equity Curve: pulled OUT of g-eq into its own full-width card
//  • Win/Loss + Timeframe: wrapped in g2 g2-keep-pair (side-by-side on tablet, stack on small phone)
//  • Strategy PNL: own full-width card
//  • Rolling WR & Avg Win/Loss: already full-width
function renderOverviewHtml(trades,stats){
  const{wins,losses,be,wr,avgWin,avgLoss,best,worst}=stats;

  const tm={};
  trades.forEach(t=>{
    const tfs=Array.isArray(t.timeframe)?t.timeframe:(t.timeframe?[t.timeframe]:[]);
    tfs.forEach(tf=>{if(!tm[tf])tm[tf]={w:0,tot:0,pnl:0};tm[tf].tot++;const p=parseFloat(t.pnl)||0;if(p>0)tm[tf].w++;tm[tf].pnl+=p;});
  });
  const tfRows=Object.keys(tm).map(tf=>{
    const d=tm[tf],wrp=d.tot?d.w/d.tot*100:0;
    return`<tr><td><strong>${tf}</strong></td><td>${d.tot}</td><td style="min-width:130px">${wrBarHtml(wrp)}</td><td style="font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;color:${grc(d.pnl)}">${fP(d.pnl)}</td></tr>`;
  }).join('')||`<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:18px">No timeframe data yet.</td></tr>`;

  return`<div style="display:flex;flex-direction:column;gap:16px">

    <!-- Equity Curve: always full-width -->
    <div class="card">
      ${secHdr('fa-chart-area','Equity Curve','Cumulative P&amp;L plotted over time.each point is the running total after that trade. A rising line means you are growing; a falling line means drawdown.')}
      <div style="height:260px;position:relative"><canvas id="eq"></canvas></div>
    </div>

    <!-- Win/Loss + Timeframe: side-by-side on tablet, stacks on small phone -->
    <div class="g2 g2-keep-pair">
      <div class="card">
        ${secHdr('fa-trophy','Win / Loss','Count of winning, losing, and break-even trades. The number in the centre is your overall win rate.aim for above 50% or compensate with a high reward-to-risk ratio.')}
        <div style="height:200px;position:relative"><canvas id="wl"></canvas></div>
        <div class="mini-stats">
          <div><div class="ms-lbl">Avg Win</div><div class="ms-val c-g">+$${avgWin.toFixed(2)}</div></div>
          <div><div class="ms-lbl">Avg Loss</div><div class="ms-val c-r">-$${avgLoss.toFixed(2)}</div></div>
          <div><div class="ms-lbl">Best</div><div class="ms-val c-g">+$${best.toFixed(2)}</div></div>
          <div><div class="ms-lbl">Worst</div><div class="ms-val c-r">-$${Math.abs(worst).toFixed(2)}</div></div>
        </div>
      </div>
      <div class="card">
        ${secHdr('fa-table','Timeframe Breakdown','Win rate and net P&amp;L split by chart timeframe (M5, H1, D1, etc.).tells you which timeframe suits your edge best.')}
        <table class="bt"><thead><tr><th>Timeframe</th><th>Trades</th><th>Win Rate</th><th>PNL</th></tr></thead><tbody>${tfRows}</tbody></table>
      </div>
    </div>

    <!-- Strategy PNL: always full-width -->
    <div class="card">
      ${secHdr('fa-chess','Strategy PNL','Net profit or loss grouped by strategy tag. Green bars are profitable strategies; red bars are losing ones. Focus on growing the green ones.')}
      <div style="height:200px;position:relative"><canvas id="st"></canvas></div>
    </div>

    <!-- Rolling Win Rate: always full-width -->
    <div class="card">
      ${secHdr('fa-chart-line','Rolling Win Rate (20 trades)','Your win rate recalculated after every trade using the last 20 trades. Rising line = good form. Falling = a losing streak forming. Dashed line = 50% breakeven.')}
      <p style="font-size:12px;color:var(--muted);margin:-6px 0 14px;line-height:1.5">Are you getting better over time, or is your edge slipping?</p>
      <div style="height:200px;position:relative"><canvas id="rwr"></canvas></div>
    </div>

    <!-- Avg Win vs Avg Loss: always full-width -->
    <div class="card">
      ${secHdr('fa-scale-balanced','Avg Win vs Avg Loss','Compares the average size of your winning trades to your losing trades. If your avg win is bigger than your avg loss, you can be profitable even with a win rate below 50%.')}
      <div id="awl"></div>
    </div>

  </div>`;
}

function initOverviewCharts(trades,stats){
  const{wins,losses,be,wr,sorted,vld}=stats;

  _makeEquityChart('eq',sorted);

  const wl=_mkChart(document.getElementById('wl'),{
    type:'doughnut',
    data:{labels:['Wins','Losses','BE'],datasets:[{data:[wins.length,losses.length,be.length],backgroundColor:[G+'dd',R+'bb','#6b8f7244'],borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'68%',plugins:{legend:{position:'bottom',labels:{padding:14,boxWidth:8,font:{size:11}}}}}
  });
  if(wl){wl._centerText=fPct(wr);wl._centerColor=wrColor(wr);}

  const sm={};
  trades.forEach(t=>{
    const ss=Array.isArray(t.strategy)?t.strategy:(t.strategy?[t.strategy]:[]);
    ss.forEach(s=>{if(!sm[s])sm[s]=0;sm[s]+=(parseFloat(t.pnl)||0);});
  });
  const sl=Object.keys(sm);
  if(sl.length){
    const sp=sl.map(s=>+sm[s].toFixed(2));
    const stBw=sl.length<=3?36:sl.length<=6?26:sl.length<=10?18:sl.length<=16?12:undefined;
    _mkChart(document.getElementById('st'),{
      type:'bar',
      data:{labels:sl,datasets:[{data:sp,backgroundColor:sp.map(v=>v>=0?G+'cc':R+'aa'),borderRadius:5,...(stBw?{barThickness:stBw}:{maxBarThickness:12})}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:sl.length>8?9:11}}},y:{ticks:{callback:v=>'$'+v.toFixed(0)}}}}
    });
  }

  const RWR_WIN=20;
  const rwrData=sorted.map((_,i)=>{
    const slice=sorted.slice(Math.max(0,i-RWR_WIN+1),i+1);
    return+(slice.filter(t=>t.pnl>0).length/slice.length*100).toFixed(1);
  });
  if(rwrData.length){
    _mkChart(document.getElementById('rwr'),{
      type:'line',
      data:{
        labels:sorted.map(t=>t.date),
        datasets:[
          {data:rwrData,borderColor:G,backgroundColor:G+'14',fill:true,tension:.4,borderWidth:2,pointRadius:0,pointHoverRadius:5,pointBackgroundColor:G},
          {data:Array(rwrData.length).fill(50),borderColor:'rgba(255,255,255,.18)',borderWidth:1,borderDash:[5,4],pointRadius:0,fill:false,tension:0}
        ]
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{display:false},
          tooltip:{
            backgroundColor:_panelColor(),borderColor:'rgba(255,255,255,.1)',borderWidth:1,
            titleColor:_tc(),bodyColor:_textColor(),padding:12,displayColors:false,
            filter:item=>item.datasetIndex===0,
            callbacks:{title:ctx=>ctx[0]?.label||'',label:ctx=>`Win Rate  ${ctx.raw}%`}
          }
        },
        scales:{
          x:{ticks:{maxTicksLimit:8,font:{size:10}}},
          y:{min:0,max:100,ticks:{callback:v=>v+'%',font:{size:10}}}
        }
      }
    });
  }

  const awlEl=document.getElementById('awl');
  if(awlEl){
    const{avgWin,avgLoss}=stats;
    const ratio=avgLoss>0?(avgWin/avgLoss).toFixed(2):'∞';
    const ratioNum=parseFloat(ratio);
    const ratioColor=ratioNum>=1?G:R;
    const maxVal=Math.max(avgWin,avgLoss,1);
    const wPct=(avgWin/maxVal*100).toFixed(0);
    const lPct=(avgLoss/maxVal*100).toFixed(0);
    const sub=ratio==='∞'?'No losses recorded yet':`For every $1 you risk, you make $${ratio} when right`;
    awlEl.innerHTML=`
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">Reward-to-Risk Ratio</div>
        <div style="font-family:var(--font-mono,'Space Mono',monospace);font-size:32px;font-weight:700;color:${ratioColor};line-height:1">${ratio}<span style="font-size:16px;opacity:.6">:1</span></div>
        <div style="font-size:11px;color:var(--muted);margin-top:6px">${sub}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
            <span style="color:var(--muted);font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.5px">Avg Win</span>
            <span style="font-family:var(--font-mono,'Space Mono',monospace);color:${G};font-weight:700">+$${avgWin.toFixed(2)}</span>
          </div>
          <div style="height:8px;background:var(--border2,#253127);border-radius:4px">
            <div style="height:8px;width:${wPct}%;background:${G};border-radius:4px"></div>
          </div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
            <span style="color:var(--muted);font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.5px">Avg Loss</span>
            <span style="font-family:var(--font-mono,'Space Mono',monospace);color:${R};font-weight:700">-$${avgLoss.toFixed(2)}</span>
          </div>
          <div style="height:8px;background:var(--border2,#253127);border-radius:4px">
            <div style="height:8px;width:${lPct}%;background:${R};border-radius:4px"></div>
          </div>
        </div>
      </div>`;
  }
}

// All three sections are now independent full-width cards (no g2 wrapper).
// On desktop they were already mostly stacked; the Day-of-Week chart was
// side-by-side with Hour Breakdown. Both now go full width on tablet/mobile.
function renderTimingHtml(trades){
  const hm={};
  trades.filter(t=>t.time&&t.time.includes(':')).forEach(t=>{
    const h=parseInt(t.time.split(':')[0],10);
    if(!hm[h])hm[h]={tot:0,wins:0,pnl:0};
    hm[h].tot++;const p=parseFloat(t.pnl)||0;if(p>0)hm[h].wins++;hm[h].pnl+=p;
  });
  const timeRows=Object.keys(hm).map(Number).sort((a,b)=>a-b).map(h=>{
    const d=hm[h],wrp=d.tot?d.wins/d.tot*100:0,avg=d.tot?d.pnl/d.tot:0;
    return`<tr><td><strong>${fH(h)}</strong></td><td>${d.tot}</td><td style="min-width:130px">${wrBarHtml(wrp)}</td><td style="font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;color:${grc(avg)}">${fP(avg)}</td></tr>`;
  }).join('')||`<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:18px">No time data yet.</td></tr>`;

  return`<div style="display:flex;flex-direction:column;gap:16px">

    <!-- Trade Volume by Hour: full-width -->
    <div class="card">
      ${secHdr('fa-fire-flame-curved','Trade Volume by Hour','Number of trades taken at each hour of the day. Taller bars = your busiest windows. Use this to spot when you overtrade or when you are most active.')}
      <div style="height:220px;position:relative"><canvas id="hh"></canvas></div>
    </div>

    <!-- Day of Week: full-width -->
    <div class="card">
      ${secHdr('fa-calendar-week','Day of Week','Number of trades placed on each day of the week.reveals your most active trading days.')}
      <div style="height:220px;position:relative"><canvas id="dow"></canvas></div>
    </div>

    <!-- Hour Breakdown table: full-width -->
    <div class="card">
      ${secHdr('fa-table','Hour Breakdown','Win rate and average P&amp;L per hour. Sorted by time.scan the Avg PNL column to find your golden hours and dead zones.')}
      <div class="scroll-tbl"><table class="bt"><thead><tr><th>Hour</th><th>Trades</th><th>Win Rate</th><th>Avg PNL</th></tr></thead><tbody>${timeRows}</tbody></table></div>
    </div>

  </div>`;
}

function initTimingCharts(trades){
  const gc=_gc();
  const hm={};
  trades.filter(t=>t.time&&t.time.includes(':')).forEach(t=>{
    const h=parseInt(t.time.split(':')[0],10);
    if(!hm[h])hm[h]={tot:0,wins:0,pnl:0};
    hm[h].tot++;const p=parseFloat(t.pnl)||0;if(p>0)hm[h].wins++;hm[h].pnl+=p;
  });
  const hl=Array.from({length:24},(_,i)=>fHs(i));
  const hc=Array.from({length:24},(_,i)=>(hm[i]||{tot:0}).tot);
  const hp=Array.from({length:24},(_,i)=>(hm[i]||{pnl:0}).pnl);
  _mkChart(document.getElementById('hh'),{
    type:'bar',
    data:{labels:hl,datasets:[{data:hc,backgroundColor:hp.map(v=>v>0?G+'bb':v<0?R+'bb':gc),borderRadius:3,barThickness:18}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{
        backgroundColor:_panelColor(),borderColor:'rgba(255,255,255,.1)',borderWidth:1,
        titleColor:_tc(),bodyColor:_textColor(),padding:12,displayColors:false,
        callbacks:{
          title:ctx=>{const h=ctx[0].dataIndex;return`${fH(h)} – ${fH(h<23?h+1:0)}`;},
          label:ctx=>{const h=ctx.dataIndex;const n=hc[h];if(!n)return'No trades';return[`${n} trade${n!==1?'s':''}`,`PNL  ${fP(hp[h])}`];}
        }
      }},
      scales:{x:{grid:{display:false},ticks:{font:{size:9}}},y:{ticks:{stepSize:1,font:{size:10}}}}}
  });

  const DOW=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const dc=[0,0,0,0,0,0,0],dp=[0,0,0,0,0,0,0];
  trades.forEach(t=>{
    if(!t.date)return;
    const d=new Date(t.date+'T12:00:00'),idx=d.getDay()===0?6:d.getDay()-1;
    dc[idx]++;dp[idx]+=(parseFloat(t.pnl)||0);
  });
  _mkChart(document.getElementById('dow'),{
    type:'bar',
    data:{labels:DOW,datasets:[{data:dc,backgroundColor:dp.map(v=>v>0?G+'bb':v<0?R+'bb':gc),borderRadius:5,barThickness:36}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{
        backgroundColor:_panelColor(),borderColor:'rgba(255,255,255,.1)',borderWidth:1,
        titleColor:_tc(),bodyColor:_textColor(),padding:12,displayColors:false,
        callbacks:{
          title:ctx=>DOW[ctx[0].dataIndex],
          label:ctx=>{const i=ctx.dataIndex;const n=dc[i];if(!n)return'No trades';return[`${n} trade${n!==1?'s':''}`,`PNL  ${fP(dp[i])}`];}
        }
      }},
      scales:{x:{grid:{display:false},ticks:{font:{size:11}}},y:{ticks:{stepSize:1,font:{size:10}}}}}
  });
}

// All four sections are now individual full-width cards (no g2 wrappers).
function renderAssetsHtml(trades,mc){
  const mm={};
  trades.forEach(t=>{
    const ms=Array.isArray(t.mood)?t.mood:(t.mood?[t.mood]:[]);
    ms.forEach(m=>{if(!mm[m])mm[m]={tot:0,wins:0,pnl:0};mm[m].tot++;const p=parseFloat(t.pnl)||0;if(p>0)mm[m].wins++;mm[m].pnl+=p;});
  });
  const moodRows=Object.keys(mm).map(m=>{
    const d=mm[m],wrp=d.tot?d.wins/d.tot*100:0,avg=d.tot?d.pnl/d.tot:0;
    return`<tr><td><strong>${m}</strong></td><td>${d.tot}</td><td style="min-width:130px">${wrBarHtml(wrp)}</td><td style="font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;color:${grc(avg)}">${fP(avg)}</td></tr>`;
  }).join('')||`<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:18px">No mood data yet.</td></tr>`;

  const cm={};
  trades.forEach(t=>{const k=t.confidence;if(!k||k<1)return;if(!cm[k])cm[k]={tot:0,wins:0,pnl:0};cm[k].tot++;const p=parseFloat(t.pnl)||0;if(p>0)cm[k].wins++;cm[k].pnl+=p;});
  const confRows=Object.keys(cm).map(Number).sort((a,b)=>b-a).map(stars=>{
    const d=cm[stars],wrp=d.tot?d.wins/d.tot*100:0,avg=d.tot?d.pnl/d.tot:0;
    return`<tr><td><span style="color:#f5c518;letter-spacing:1px">${'★'.repeat(stars)}<span style="opacity:.2">${'★'.repeat(5-stars)}</span></span></td><td>${d.tot}</td><td style="min-width:130px">${wrBarHtml(wrp)}</td><td style="font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;color:${grc(avg)}">${fP(avg)}</td></tr>`;
  }).join('')||`<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:18px">No confidence data yet.</td></tr>`;

  const pairMap={};
  trades.forEach(t=>{if(!t.pair)return;if(!pairMap[t.pair])pairMap[t.pair]={pnl:0,cnt:0};pairMap[t.pair].pnl+=parseFloat(t.pnl)||0;pairMap[t.pair].cnt++;});
  const pairList=Object.entries(pairMap).map(([p,d])=>({p,pnl:+d.pnl.toFixed(2),cnt:d.cnt})).sort((a,b)=>b.pnl-a.pnl);
  const maxAbs=pairList.length?Math.max(...pairList.map(x=>Math.abs(x.pnl)),1):1;
  const pairHtml=pairList.slice(0,8).map(x=>{
    const color=x.pnl>=0?G:R,w=(Math.abs(x.pnl)/maxAbs*100).toFixed(0);
    return`<div class="pair-row"><div class="pair-meta"><span style="font-weight:600">${x.p}</span><span><span style="font-family:var(--font-mono,'Space Mono',monospace);color:${color};font-size:12px">${fP(x.pnl)}</span><span style="color:var(--muted);margin-left:6px;font-size:11px">${x.cnt} Trade${x.cnt!==1?'s':''}</span></span></div><div class="pair-track"><div class="pair-fill" style="width:${w}%;background:${color}"></div></div></div>`;
  }).join('')||`<span style="color:var(--muted);font-size:13px">No pair data yet.</span>`;

  return`<div style="display:flex;flex-direction:column;gap:16px">

    <!-- Top Pairs: full-width -->
    <div class="card">
      ${secHdr('fa-ranking-star','Top Pairs by PNL','Cumulative net profit or loss per instrument, sorted best to worst. Bar width shows relative size. Tells you which markets you trade well and which drain your account.')}
      ${pairHtml}
    </div>

    <!-- Long vs Short: full-width -->
    <div class="card">
      ${secHdr('fa-arrow-right-arrow-left','Long vs Short','Split between buy-side (Long) and sell-side (Short) positions. A heavy skew in one direction could mean you have a directional bias.useful to know if the market is trending against you.')}
      <div style="height:200px;position:relative"><canvas id="ls"></canvas></div>
    </div>

    <!-- Mood vs Performance: full-width -->
    <div class="card">
      ${secHdr('fa-face-smile','Mood vs Performance','Win rate and average P&amp;L per mood tag. If Anxious or Tired moods have lower win rates, that is a signal to step back when you feel that way.')}
      <table class="bt"><thead><tr><th>Mood</th><th>Trades</th><th>Win Rate</th><th>Avg PNL</th></tr></thead><tbody>${moodRows}</tbody></table>
    </div>

    <!-- Confidence vs Performance: full-width -->
    <div class="card">
      ${secHdr('fa-star','Confidence vs Performance','Win rate and average P&amp;L grouped by the star rating you gave each trade before entry. Ideally your 5-star trades outperform your 1-star trades.if not, your pre-trade confidence is not well-calibrated.')}
      <table class="bt"><thead><tr><th>Confidence</th><th>Trades</th><th>Win Rate</th><th>Avg PNL</th></tr></thead><tbody>${confRows}</tbody></table>
    </div>

  </div>`;
}

function initAssetsCharts(trades){
  const longs=trades.filter(t=>t.position==='Long').length;
  const shorts=trades.filter(t=>t.position==='Short').length;
  _mkChart(document.getElementById('ls'),{
    type:'doughnut',
    data:{labels:['Long','Short'],datasets:[{data:[longs,shorts],backgroundColor:[G+'cc',R+'aa'],borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{position:'bottom',labels:{padding:14,boxWidth:8,font:{size:11}}}}}
  });
}

function renderInsightsHtml(trades, stats) {
  const { vld, wins, losses, be, wr, pf, maxDd, consistency, sorted, avgWin, avgLoss, best, worst, mxW, mxL, total, avgR } = stats;

  if (vld.length < 5) {
    return `<div style="color:var(--muted);text-align:center;padding:60px 0;font-size:14px;line-height:2">
      <i class="fa-solid fa-brain" style="font-size:36px;display:block;margin-bottom:16px;opacity:.2"></i>
      Need at least 5 closed trades to generate insights.<br>
      <span style="font-size:12px">Keep logging. Your edge reveals itself through data.</span>
    </div>`;
  }

  const totalEquity = Math.abs(vld.reduce((s, t) => s + t.pnl, 0)) || 1;
  const ddPct = Math.min(maxDd / totalEquity, 1);
  const score = Math.round((wr / 50) * 25 + (Math.min(pf, 3) / 3) * 25 + (1 - ddPct) * 25 + consistency * 25);
  const level = score > 70 ? 'Low Risk' : score > 50 ? 'Medium Risk' : 'High Risk';
  const scoreColor = score > 70 ? G : score > 50 ? Y : R;
  const circ = 2 * Math.PI * 40;
  const dash = circ * (1 - score / 100);

  // Day of week analysis
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dowData = Array.from({ length: 7 }, () => ({ tot: 0, wins: 0, pnl: 0 }));
  vld.forEach(t => {
    if (!t.date) return;
    const d = new Date(t.date + 'T12:00:00'), idx = d.getDay() === 0 ? 6 : d.getDay() - 1;
    dowData[idx].tot++;
    if (t.pnl > 0) dowData[idx].wins++;
    dowData[idx].pnl += t.pnl;
  });
  const dowWithData = dowData.map((d, i) => ({ ...d, day: DOW[i], wr: d.tot ? d.wins / d.tot * 100 : 0 })).filter(d => d.tot > 0);
  const bestDay = dowWithData.length ? [...dowWithData].sort((a, b) => b.pnl - a.pnl)[0] : null;
  const worstDay = dowWithData.length ? [...dowWithData].sort((a, b) => a.pnl - b.pnl)[0] : null;

  // Hour analysis
  const hourData = {};
  vld.filter(t => t.time && t.time.includes(':')).forEach(t => {
    const h = parseInt(t.time.split(':')[0], 10);
    if (!hourData[h]) hourData[h] = { tot: 0, wins: 0, pnl: 0 };
    hourData[h].tot++;
    if (t.pnl > 0) hourData[h].wins++;
    hourData[h].pnl += t.pnl;
  });
  const hourArr = Object.entries(hourData).map(([h, d]) => ({ h: +h, ...d, wr: d.tot ? d.wins / d.tot * 100 : 0 }));
  const bestHour = hourArr.length ? [...hourArr].sort((a, b) => b.pnl - a.pnl)[0] : null;
  const worstHour = hourArr.length ? [...hourArr].sort((a, b) => a.pnl - b.pnl)[0] : null;

  // Strategy analysis
  const stratMap = {};
  vld.forEach(t => {
    const ss = Array.isArray(t.strategy) ? t.strategy : (t.strategy ? [t.strategy] : []);
    ss.forEach(s => {
      if (!stratMap[s]) stratMap[s] = { tot: 0, wins: 0, pnl: 0 };
      stratMap[s].tot++;
      if (t.pnl > 0) stratMap[s].wins++;
      stratMap[s].pnl += t.pnl;
    });
  });
  const stratArr = Object.entries(stratMap).map(([s, d]) => ({ s, ...d, wr: d.tot ? d.wins / d.tot * 100 : 0 }));
  const bestStrat = stratArr.length ? [...stratArr].sort((a, b) => b.pnl - a.pnl)[0] : null;
  const worstStrat = stratArr.length ? [...stratArr].sort((a, b) => a.pnl - b.pnl)[0] : null;

  // Pair analysis
  const pairMap = {};
  vld.forEach(t => {
    if (!t.pair) return;
    if (!pairMap[t.pair]) pairMap[t.pair] = { tot: 0, wins: 0, pnl: 0 };
    pairMap[t.pair].tot++;
    if (t.pnl > 0) pairMap[t.pair].wins++;
    pairMap[t.pair].pnl += t.pnl;
  });
  const pairArr = Object.entries(pairMap).map(([p, d]) => ({ p, ...d, wr: d.tot ? d.wins / d.tot * 100 : 0 }));
  const bestPair = pairArr.length ? [...pairArr].sort((a, b) => b.pnl - a.pnl)[0] : null;
  const worstPair = pairArr.length ? [...pairArr].sort((a, b) => a.pnl - b.pnl)[0] : null;

  // Mood analysis
  const moodMap = {};
  vld.forEach(t => {
    const ms = Array.isArray(t.mood) ? t.mood : (t.mood ? [t.mood] : []);
    ms.forEach(m => {
      if (!moodMap[m]) moodMap[m] = { tot: 0, wins: 0, pnl: 0 };
      moodMap[m].tot++;
      if (t.pnl > 0) moodMap[m].wins++;
      moodMap[m].pnl += t.pnl;
    });
  });
  const moodArr = Object.entries(moodMap).map(([m, d]) => ({ m, ...d, wr: d.tot ? d.wins / d.tot * 100 : 0, avg: d.tot ? d.pnl / d.tot : 0 }));
  const bestMood = moodArr.length ? [...moodArr].sort((a, b) => b.avg - a.avg)[0] : null;
  const worstMood = moodArr.length ? [...moodArr].sort((a, b) => a.avg - b.avg)[0] : null;

  // Confidence analysis
  const confMap = {};
  vld.forEach(t => {
    const k = t.confidence;
    if (!k || k < 1) return;
    if (!confMap[k]) confMap[k] = { tot: 0, wins: 0, pnl: 0 };
    confMap[k].tot++;
    if (t.pnl > 0) confMap[k].wins++;
    confMap[k].pnl += t.pnl;
  });
  const confArr = Object.keys(confMap).map(Number).sort((a, b) => b - a).map(stars => ({ stars, ...confMap[stars], wr: confMap[stars].tot ? confMap[stars].wins / confMap[stars].tot * 100 : 0, avg: confMap[stars].tot ? confMap[stars].pnl / confMap[stars].tot : 0 }));
  const confCalibrated = confArr.length >= 2 && confArr[0].avg > confArr[confArr.length - 1].avg;

  // Long vs Short analysis
  const longs = vld.filter(t => t.position === 'Long');
  const shorts = vld.filter(t => t.position === 'Short');
  const longPnl = longs.reduce((s, t) => s + t.pnl, 0);
  const shortPnl = shorts.reduce((s, t) => s + t.pnl, 0);
  const longWr = longs.length ? longs.filter(t => t.pnl > 0).length / longs.length * 100 : 0;
  const shortWr = shorts.length ? shorts.filter(t => t.pnl > 0).length / shorts.length * 100 : 0;
  const hasBias = longs.length > 0 && shorts.length > 0 && Math.abs(longs.length - shorts.length) / vld.length > 0.3;
  const biasSide = longs.length > shorts.length ? 'Long' : 'Short';
  const biasBetter = biasSide === 'Long' ? longPnl > shortPnl : shortPnl > longPnl;

  // Revenge trading detection: loss immediately followed by larger position/loss
  let revengeSignals = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].pnl < -20 && sorted[i].pnl < sorted[i - 1].pnl * 0.8) revengeSignals++;
  }
  const hasRevengePattern = revengeSignals >= 2;

  // Overtrading: days with 5+ trades
  const tradesPerDay = {};
  vld.forEach(t => { if (t.date) tradesPerDay[t.date] = (tradesPerDay[t.date] || 0) + 1; });
  const dayCount = Object.keys(tradesPerDay).length || 1;
  const avgPerDay = vld.length / dayCount;
  const overtradingDays = Object.values(tradesPerDay).filter(n => n >= 5).length;
  const overtradingDayPnl = [];
  Object.entries(tradesPerDay).forEach(([date, cnt]) => {
    if (cnt >= 5) {
      const dayPnl = vld.filter(t => t.date === date).reduce((s, t) => s + t.pnl, 0);
      overtradingDayPnl.push(dayPnl);
    }
  });
  const avgOvertradingDayPnl = overtradingDayPnl.length ? overtradingDayPnl.reduce((a, b) => a + b, 0) / overtradingDayPnl.length : 0;

  // Consecutive loss analysis (current streak)
  let currentStreak = 0, currentStreakDir = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const dir = sorted[i].pnl > 0 ? 'W' : sorted[i].pnl < 0 ? 'L' : null;
    if (!dir) break;
    if (!currentStreakDir) currentStreakDir = dir;
    if (dir !== currentStreakDir) break;
    currentStreak++;
  }

  // Trade size consistency
  const sizes = vld.map(t => Math.abs(parseFloat(t.pnl) || 0)).filter(v => v > 0);
  const sizeMean = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  const sizeVariance = sizes.reduce((s, n) => s + Math.pow(n - sizeMean, 2), 0) / (sizes.length || 1);
  const sizeStd = Math.sqrt(sizeVariance);
  const sizeCV = sizeMean > 0 ? sizeStd / sizeMean : 0;
  const inconsistentSizing = sizeCV > 0.8;

  // Early exit detection: wins that are below avg win by >50%
  const smallWins = wins.filter(t => t.pnl < avgWin * 0.5);
  const earlyExitRate = wins.length ? smallWins.length / wins.length : 0;
  const earlyExitIssue = earlyExitRate > 0.35;

  // Large loss outliers: losses bigger than 2x avg loss
  const bigLosses = losses.filter(t => Math.abs(t.pnl) > avgLoss * 2);
  const bigLossImpact = bigLosses.reduce((s, t) => s + t.pnl, 0);

  // Timeframe performance
  const tfMap = {};
  vld.forEach(t => {
    const tfs = Array.isArray(t.timeframe) ? t.timeframe : (t.timeframe ? [t.timeframe] : []);
    tfs.forEach(tf => {
      if (!tfMap[tf]) tfMap[tf] = { tot: 0, wins: 0, pnl: 0 };
      tfMap[tf].tot++;
      if (t.pnl > 0) tfMap[tf].wins++;
      tfMap[tf].pnl += t.pnl;
    });
  });
  const tfArr = Object.entries(tfMap).map(([tf, d]) => ({ tf, ...d, wr: d.tot ? d.wins / d.tot * 100 : 0 }));
  const bestTf = tfArr.length ? [...tfArr].sort((a, b) => b.pnl - a.pnl)[0] : null;
  const worstTf = tfArr.length ? [...tfArr].sort((a, b) => a.pnl - b.pnl)[0] : null;

  // Month over month trend (last 2 months)
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonthTrades = vld.filter(t => t.date && new Date(t.date + 'T12:00:00') >= thisMonthStart);
  const lastMonthTrades = vld.filter(t => t.date && new Date(t.date + 'T12:00:00') >= lastMonthStart && new Date(t.date + 'T12:00:00') < thisMonthStart);
  const thisMonthPnl = thisMonthTrades.reduce((s, t) => s + t.pnl, 0);
  const lastMonthPnl = lastMonthTrades.reduce((s, t) => s + t.pnl, 0);
  const momImproving = lastMonthTrades.length > 0 && thisMonthPnl > lastMonthPnl;
  const momData = lastMonthTrades.length > 0 && thisMonthTrades.length > 0;

  const buildNarrative = () => {
    const parts = [];
    if (score > 70) {
      parts.push(`Your trading profile is <strong style="color:${G}">performing well</strong> across all key dimensions.`);
    } else if (score > 50) {
      parts.push(`Your trading shows <strong style="color:${Y}">moderate consistency</strong> with clear areas to improve.`);
    } else {
      parts.push(`Your current metrics signal <strong style="color:${R}">elevated risk</strong>. Some structural issues need attention before scaling up.`);
    }
    if (wr >= 50 && pf >= 1.5) {
      parts.push(`With a <strong>${wr.toFixed(1)}% win rate</strong> and <strong>${pf.toFixed(2)} profit factor</strong>, your edge is statistically confirmed.`);
    } else if (wr < 50 && pf >= 1.5) {
      parts.push(`Despite a sub-50% win rate of <strong>${wr.toFixed(1)}%</strong>, your <strong>${pf.toFixed(2)} profit factor</strong> shows your winners far outweigh your losers. This is a valid, asymmetric style.`);
    } else if (wr >= 50 && pf < 1.2) {
      parts.push(`Your <strong>${wr.toFixed(1)}% win rate</strong> looks good on paper, but a profit factor of <strong>${pf.toFixed(2)}</strong> shows that losses are eating into gains. Focus on cutting losers faster.`);
    } else {
      parts.push(`With <strong>${wr.toFixed(1)}% win rate</strong> and <strong>${pf.toFixed(2)} profit factor</strong>, both entry quality and loss management need work simultaneously.`);
    }
    if (bestDay && bestStrat) {
      parts.push(`Your strongest context is <strong>${bestStrat.s}</strong> on <strong>${bestDay.day}s</strong>. This combination drives the bulk of your P&L.`);
    } else if (bestDay) {
      parts.push(`<strong>${bestDay.day}s</strong> are consistently your best trading day, contributing <strong style="color:${G}">${fP(bestDay.pnl)}</strong> to your total.`);
    }
    if (hasRevengePattern) {
      parts.push(`A <strong style="color:${R}">revenge trading pattern</strong> was detected. Losses are often followed by larger, compounding losses.`);
    } else if (earlyExitIssue) {
      parts.push(`You're leaving money on the table by exiting winners too early. <strong>${(earlyExitRate * 100).toFixed(0)}%</strong> of your wins are below half your average win size.`);
    }
    if (momData) {
      if (momImproving) {
        parts.push(`Month-over-month, you are <strong style="color:${G}">trending upward</strong>. This month's P&L of <strong style="color:${G}">${fP(thisMonthPnl)}</strong> beats last month's <strong>${fP(lastMonthPnl)}</strong>.`);
      } else {
        parts.push(`Month-over-month, you are <strong style="color:${R}">trending downward</strong>. This month's <strong style="color:${R}">${fP(thisMonthPnl)}</strong> lags behind last month's <strong>${fP(lastMonthPnl)}</strong>.`);
      }
    }
    return parts.join(' ');
  };

  const buildFindings = () => {
    const cards = [];
    if (bestDay) cards.push({ icon: 'fa-star', color: G, label: 'Best Day', value: bestDay.day, sub: `${fP(bestDay.pnl)} · ${bestDay.wr.toFixed(0)}% WR in ${bestDay.tot} trades` });
    if (bestStrat) cards.push({ icon: 'fa-chess-knight', color: G, label: 'Top Strategy', value: bestStrat.s, sub: `${fP(bestStrat.pnl)} · ${bestStrat.wr.toFixed(0)}% WR in ${bestStrat.tot} trades` });
    if (bestPair) cards.push({ icon: 'fa-coins', color: G, label: 'Best Pair', value: bestPair.p, sub: `${fP(bestPair.pnl)} · ${bestPair.wr.toFixed(0)}% WR in ${bestPair.tot} trades` });
    if (bestMood) cards.push({ icon: 'fa-face-smile', color: G, label: 'Best Mood', value: bestMood.m, sub: `Avg ${fP(bestMood.avg)} per trade · ${bestMood.wr.toFixed(0)}% WR` });
    if (worstDay && worstDay.pnl < 0) cards.push({ icon: 'fa-calendar-xmark', color: R, label: 'Worst Day', value: worstDay.day, sub: `${fP(worstDay.pnl)} · ${worstDay.wr.toFixed(0)}% WR in ${worstDay.tot} trades` });
    if (worstStrat && worstStrat.pnl < 0) cards.push({ icon: 'fa-triangle-exclamation', color: R, label: 'Drag Strategy', value: worstStrat.s, sub: `${fP(worstStrat.pnl)} dragging overall PNL` });
    if (worstPair && worstPair.pnl < 0) cards.push({ icon: 'fa-money-bill-trend-up', color: R, label: 'Worst Pair', value: worstPair.p, sub: `${fP(worstPair.pnl)} net loss on this instrument` });
    if (worstMood && worstMood.avg < 0) cards.push({ icon: 'fa-face-sad-tear', color: R, label: 'Worst Mood', value: worstMood.m, sub: `Avg ${fP(worstMood.avg)} per trade.consider stepping back` });
    return cards.slice(0, 8);
  };

  const buildRecs = () => {
    const recs = [];

    if (hasRevengePattern) recs.push({
      p: 'high', icon: 'fa-fire',
      a: 'Break the revenge trading cycle',
      r: `Detected ${revengeSignals} instance${revengeSignals > 1 ? 's' : ''} where a losing trade was immediately followed by a larger loss. After any trade losing more than $${(avgLoss * 0.8).toFixed(0)}, enforce a mandatory 30-minute cooldown before your next entry. This single rule can recover significant P&L.`
    });

    if (maxDd > totalEquity * 0.3) recs.push({
      p: 'high', icon: 'fa-shield-halved',
      a: 'Your max drawdown is dangerously high',
      r: `A $${maxDd.toFixed(0)} drawdown against $${totalEquity.toFixed(0)} net equity means you've given back ${(maxDd / totalEquity * 100).toFixed(0)}% of your gains in a single drawdown event. Implement a daily loss limit of $${(avgLoss * 3).toFixed(0)} and a maximum of ${Math.max(3, Math.round(avgPerDay))} trades per day.`
    });

    if (pf < 1 && vld.length >= 10) recs.push({
      p: 'high', icon: 'fa-scale-unbalanced-flip',
      a: 'Gross losses exceed gross wins',
      r: `Profit factor of ${pf.toFixed(2)} means for every $1 you make, you lose $${(1 / pf).toFixed(2)}. Your avg win is $${avgWin.toFixed(2)} and avg loss is $${avgLoss.toFixed(2)}. You need to either tighten stops (reduce avg loss to below $${avgWin.toFixed(0)}) or widen targets (increase avg win above $${avgLoss.toFixed(0)}).`
    });

    if (wr < 40) recs.push({
      p: 'high', icon: 'fa-bullseye',
      a: 'Win rate is critically low',
      r: `At ${wr.toFixed(1)}%, you are losing more than 6 of every 10 trades. With your current avg win of $${avgWin.toFixed(2)}, you need at least a ${(avgLoss / (avgWin + avgLoss) * 100).toFixed(0)}% win rate to break even. Consider paper-trading your setups for 2 weeks to diagnose entry problems without real capital at risk.`
    });

    if (bigLosses.length >= 2) recs.push({
      p: 'high', icon: 'fa-bomb',
      a: `${bigLosses.length} outlier losses are destroying your P&L`,
      r: `You have ${bigLosses.length} trades where losses exceeded 2× your average loss of $${avgLoss.toFixed(2)}. These alone account for $${Math.abs(bigLossImpact).toFixed(0)} in damage. This is a stop-loss discipline problem.set hard maximum loss per trade and never move stops further away once in a trade.`
    });

    if (earlyExitIssue) recs.push({
      p: 'medium', icon: 'fa-hand',
      a: 'Stop cutting winners short',
      r: `${(earlyExitRate * 100).toFixed(0)}% of your winning trades close below half your average win of $${avgWin.toFixed(2)}. This suggests you're taking profits at the first sign of pullback. Try a trailing stop or scaling out in thirds.let at least 1/3 of the position run to your full target. Could add $${(smallWins.length * avgWin * 0.5).toFixed(0)} to your P&L.`
    });

    if (inconsistentSizing) recs.push({
      p: 'medium', icon: 'fa-ruler',
      a: 'Inconsistent position sizing detected',
      r: `Your trade P&L swings wildly (std deviation $${sizeStd.toFixed(0)} on a mean of $${sizeMean.toFixed(0)}). Erratic sizing means your win rate and profit factor are unreliable.one big trade skews everything. Standardise to a fixed risk-per-trade of 1% of account per position. Consistency compounds.`
    });

    if (overtradingDays >= 3) recs.push({
      p: 'medium', icon: 'fa-hourglass-end',
      a: 'Overtrading on high-volume days hurts you',
      r: `On ${overtradingDays} days where you took 5+ trades, your average daily P&L was $${avgOvertradingDayPnl.toFixed(2)}${avgOvertradingDayPnl < 0 ? ' (a loss)' : ''}. Quality declines with volume. Set a hard cap of ${Math.max(3, Math.round(avgPerDay * 1.2))} trades per day. Walk away after that limit, profit or loss.`
    });

    if (worstDay && worstDay.pnl < -avgLoss * 3) recs.push({
      p: 'medium', icon: 'fa-calendar-xmark',
      a: `Consider avoiding <strong>${worstDay.day}s</strong> entirely`,
      r: `<strong>${worstDay.day}</strong> is your worst performing day with ${fP(worstDay.pnl)} net and only ${worstDay.wr.toFixed(0)}% win rate across ${worstDay.tot} trades. Compare this to ${bestDay ? '<strong>' + bestDay.day + '</strong> (' + bestDay.wr.toFixed(0) + '% WR)' : 'your best day'}. Some traders eliminate their worst day completely and see immediate improvement.`
    });

    if (worstStrat && worstStrat.pnl < 0 && bestStrat && bestStrat.pnl > 0) recs.push({
      p: 'medium', icon: 'fa-scissors',
      a: `Kill your <strong>"${worstStrat.s}"</strong> strategy`,
      r: `<strong>"${worstStrat.s}"</strong> has generated ${fP(worstStrat.pnl)} in losses across ${worstStrat.tot} trades (${worstStrat.wr.toFixed(0)}% WR). Meanwhile, <strong>"${bestStrat.s}"</strong> has produced ${fP(bestStrat.pnl)} with ${bestStrat.wr.toFixed(0)}% WR. Every dollar you risk on the losing strategy is a dollar not allocated to the winning one. Retire it for 30 days and track the difference.`
    });

    if (hasBias && !biasBetter) recs.push({
      p: 'medium', icon: 'fa-arrow-right-arrow-left',
      a: `Your <strong>${biasSide}</strong> bias is costing you`,
      r: `${(biasSide === 'Long' ? longs.length : shorts.length)} of your ${vld.length} trades are <strong>${biasSide}</strong>, but your <strong>${biasSide}</strong> PNL of ${fP(biasSide === 'Long' ? longPnl : shortPnl)} lags behind your <strong>${biasSide === 'Long' ? 'Short' : 'Long'}</strong> PNL of ${fP(biasSide === 'Long' ? shortPnl : longPnl)}. You have a structural directional bias that's not aligned with where your actual edge lives. Force yourself to take the other side more often.`
    });

    if (worstMood && worstMood.avg < -avgLoss * 0.5 && worstMood.tot >= 3) recs.push({
      p: 'medium', icon: 'fa-brain',
      a: `Don't trade when feeling <strong>"${worstMood.m}"</strong>`,
      r: `Your <strong>"${worstMood.m}"</strong> mood trades average ${fP(worstMood.avg)} per trade with ${worstMood.wr.toFixed(0)}% win rate. Significantly below your overall average. Emotional state is a legitimate edge variable. Log your mood before every session and treat <strong>"${worstMood.m}"</strong> as a no-trade signal until your data shows improvement.`
    });

    if (confArr.length >= 2 && !confCalibrated) recs.push({
      p: 'medium', icon: 'fa-star-half-stroke',
      a: 'Confidence rating is not predicting outcomes',
      r: `Your high-confidence trades are NOT outperforming low-confidence ones. Which means your pre-trade analysis is unreliable. This is often caused by confirmation bias (seeing setups that aren't there). Try paper-grading each setup against your written rules before entering, separate from gut feel.`
    });

    if (worstHour && worstHour.pnl < 0 && worstHour.tot >= 3) recs.push({
      p: 'medium', icon: 'fa-clock',
      a: `Block out <strong>${fH(worstHour.h)}</strong> from your trading schedule`,
      r: `The <strong>${fH(worstHour.h)}</strong> to <strong>${fH(worstHour.h < 23 ? worstHour.h + 1 : 0)}</strong> window is your worst hour: ${fP(worstHour.pnl)} net across ${worstHour.tot} trades with ${worstHour.wr.toFixed(0)}% WR. ${bestHour ? `By contrast, <strong>${fH(bestHour.h)}</strong> has delivered ${fP(bestHour.pnl)} with ${bestHour.wr.toFixed(0)}% WR. ` : ''}Consider removing this time slot from your trading plan entirely.`
    });

    if (worstTf && worstTf.pnl < 0 && bestTf && bestTf !== worstTf) recs.push({
      p: 'medium', icon: 'fa-layer-group',
      a: `Drop the <strong>${worstTf.tf}</strong> timeframe`,
      r: `The <strong>${worstTf.tf}</strong> timeframe is contributing ${fP(worstTf.pnl)} in losses with only ${worstTf.wr.toFixed(0)}% win rate. Your <strong>${bestTf.tf}</strong> timeframe performs significantly better at ${bestTf.wr.toFixed(0)}% WR and ${fP(bestTf.pnl)} net. Specialise. Multi-timeframe trading only helps when each timeframe has independent edge.`
    });

    if (wr > 58 && pf > 1.8) recs.push({
      p: 'positive', icon: 'fa-rocket',
      a: 'Strong edge confirmed. Scale up carefully',
      r: `<strong>${wr.toFixed(1)}%</strong> win rate with <strong>${pf.toFixed(2)}</strong> profit factor on <strong>${vld.length}</strong> trades is statistically significant. Your edge is real. Focus next on increasing position size by 10-15% and tracking whether performance holds. If metrics stay within 5% of current numbers over 20+ trades, continue scaling.`
    });

    if (mxW >= 5) recs.push({
      p: 'positive', icon: 'fa-fire-flame-curved',
      a: `<strong>${mxW}</strong>-trade win streak shows momentum ability`,
      r: `Your longest win streak of <strong>${mxW}</strong> consecutive winners demonstrates you can run hot. Study those trades carefully. What was the market context, the setup, the time of day? Replicate those conditions intentionally. Streaks are usually not random; they reflect a specific market regime where your edge thrives.`
    });

    if (consistency > 0.6) recs.push({
      p: 'positive', icon: 'fa-check-double',
      a: 'Daily consistency score is solid',
      r: `Your consistency score of <strong>${(consistency * 100).toFixed(0)}%</strong> means your daily P&L doesn't swing wildly. A sign of disciplined sizing and emotional control. This is the foundation required before scaling. Continue logging every trade, even the ones you're tempted to hide.`
    });

    if (bestMood && bestMood.avg > avgWin * 0.8 && bestMood.tot >= 3) recs.push({
      p: 'positive', icon: 'fa-face-smile-beam',
      a: `Prioritise <strong>"${bestMood.m}"</strong> trading sessions`,
      r: `When you trade in a <strong>"${bestMood.m}"</strong> mood, your average P&L is <strong>${fP(bestMood.avg)}</strong>. Your best emotional context. Create a pre-session ritual that cultivates this state: adequate sleep, exercise, reviewing your rules. High-quality mental states are a repeatable edge.`
    });

    if (confCalibrated && confArr[0].avg > 0) recs.push({
      p: 'positive', icon: 'fa-star',
      a: 'Confidence rating predicts outcomes. Trust it',
      r: `Your <strong>5-star</strong> trades outperform your <strong>1-star</strong> trades, meaning your intuition and pre-analysis are well-calibrated. This is valuable. Consider sizing up on <strong>4-5 star</strong> setups by 20-30% and sizing down on <strong>1-2 star</strong> setups. This alone could improve your profit factor without changing your strategy.`
    });

    if (recs.length === 0) recs.push({
      p: 'neutral', icon: 'fa-chart-line',
      a: 'Continue monitoring.no critical issues found',
      r: 'Your metrics are within acceptable ranges. Focus on increasing sample size.a minimum of 50–100 trades is needed for statistically robust conclusions. Keep logging every trade with full context (mood, strategy, timeframe) for richer future insights.'
    });

    recs.sort((a, b) => ({ high: 0, medium: 1, positive: 2, neutral: 3 }[a.p] || 3) - ({ high: 0, medium: 1, positive: 2, neutral: 3 }[b.p] || 3));
    return recs;
  };

  const buildFocus = () => {
    const items = [];
    const recs = buildRecs();
    const top = recs.filter(r => r.p === 'high').slice(0, 2);
    if (top.length === 0) {
      items.push(...recs.filter(r => r.p === 'medium').slice(0, 2));
    } else {
      items.push(...top);
    }
    if (bestStrat) items.push({ p: 'focus', icon: 'fa-crosshairs', a: `Double down on "${bestStrat.s}"`, r: `Take only this strategy's setups for the next 20 trades and track independently. Isolating your best edge compounds its effect.` });
    return items.slice(0, 3);
  };

  const radarScores = {
    'Entry Quality': Math.min(100, Math.round(wr * 1.2)),
    'Exit Quality': Math.min(100, Math.round(earlyExitIssue ? 40 : pf >= 1.5 ? 80 : 60)),
    'Risk Mgmt': Math.min(100, Math.round((1 - ddPct) * 100)),
    'Consistency': Math.min(100, Math.round(consistency * 100)),
    'Discipline': Math.min(100, Math.round(hasRevengePattern ? 30 : overtradingDays > 3 ? 50 : inconsistentSizing ? 55 : 80)),
    'Timing': Math.min(100, Math.round(bestHour ? bestHour.wr : wr)),
  };

  const findings = buildFindings();
  const recs = buildRecs();
  const focusItems = buildFocus();
  const narrative = buildNarrative();

  const priorityMeta = {
    high:     { label: 'HIGH PRIORITY', bg: 'rgba(240,81,101,.07)',  border: 'rgba(240,81,101,.3)',  dot: R },
    medium:   { label: 'REVIEW',        bg: 'rgba(245,197,24,.07)',  border: 'rgba(245,197,24,.3)',  dot: Y },
    positive: { label: 'STRENGTH',      bg: 'rgba(25,195,125,.07)',  border: 'rgba(25,195,125,.3)',  dot: G },
    neutral:  { label: 'NOTE',          bg: 'rgba(107,143,114,.07)', border: 'rgba(107,143,114,.2)', dot: 'var(--muted)' },
    focus:    { label: 'FOCUS',         bg: 'rgba(25,195,125,.07)',  border: 'rgba(25,195,125,.3)',  dot: G },
  };

  const scoreGaugeHtml = `
    <div style="position:relative;width:110px;height:110px;flex-shrink:0">
      <svg width="110" height="110" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#253127" stroke-width="8"/>
        <circle cx="50" cy="50" r="40" fill="none" stroke="${scoreColor}" stroke-width="8"
          stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${dash.toFixed(2)}"
          stroke-linecap="round" transform="rotate(-90 50 50)"
          style="transition:stroke-dashoffset .8s ease"/>
      </svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
        <span style="font-family:var(--font-mono,'Space Mono',monospace);font-size:22px;font-weight:700;color:${scoreColor}">${score}</span>
        <span style="font-size:9px;color:var(--muted);letter-spacing:.5px">/ 100</span>
      </div>
    </div>`;

  const radarHtml = Object.entries(radarScores).map(([label, val]) => {
    const color = val >= 70 ? G : val >= 45 ? Y : R;
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
        <span style="color:var(--muted)">${label}</span>
        <span style="font-family:var(--font-mono,'Space Mono',monospace);color:${color};font-weight:600">${val}</span>
      </div>
      <div style="height:5px;background:var(--border2,#253127);border-radius:3px">
        <div style="height:5px;width:${val}%;background:${color};border-radius:3px;transition:width .6s ease"></div>
      </div>
    </div>`;
  }).join('');

  const findingsHtml = findings.map(f => `
    <div style="background:var(--panel2,#192219);border:1px solid var(--border2,#253127);border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:4px">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:2px">
        <i class="fa-solid ${f.icon}" style="color:${f.color};font-size:12px"></i>
        <span style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;font-weight:700">${f.label}</span>
      </div>
      <div style="font-weight:700;font-size:14px;color:${f.color}">${f.value}</div>
      <div style="font-size:11px;color:var(--muted);line-height:1.5">${f.sub}</div>
    </div>`).join('');

  const recsHtml = recs.map(r => {
    const m = priorityMeta[r.p] || priorityMeta.neutral;
    return `<div style="background:${m.bg};border:1px solid ${m.border};border-radius:10px;padding:14px 16px;display:flex;gap:14px;align-items:flex-start;margin-bottom:10px">
      <div style="width:32px;height:32px;border-radius:8px;background:${m.border};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
        <i class="fa-solid ${r.icon}" style="color:${m.dot};font-size:13px"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap">
          <span style="font-weight:700;font-size:13px;color:var(--text)">${r.a}</span>
          <span style="font-size:9px;font-weight:700;letter-spacing:.8px;color:${m.dot};background:${m.border};padding:2px 7px;border-radius:4px">${m.label}</span>
        </div>
        <div style="font-size:12px;color:var(--muted);line-height:1.65">${r.r}</div>
      </div>
    </div>`;
  }).join('');

  const focusHtml = focusItems.map((f, i) => `
    <div style="display:flex;gap:12px;align-items:flex-start;padding:12px 0;${i < focusItems.length - 1 ? 'border-bottom:1px solid var(--border)' : ''}">
      <div style="width:24px;height:24px;border-radius:50%;background:rgba(25,195,125,.15);border:1px solid rgba(25,195,125,.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;font-weight:700;color:${G}">${i + 1}</div>
      <div>
        <div style="font-weight:600;font-size:13px;color:var(--text);margin-bottom:3px">${f.a}</div>
        <div style="font-size:12px;color:var(--muted);line-height:1.5">${f.r}</div>
      </div>
    </div>`).join('');

  const miniMetrics = [
    ['Win Rate',     fPct(wr),                          grc(wr - 50)],
    ['Profit Factor',pf === 999 ? '∞' : pf.toFixed(2), grc(pf - 1)],
    ['Max Drawdown', '-$' + maxDd.toFixed(0),           R],
    ['Avg Win',      '+$' + avgWin.toFixed(2),          G],
    ['Avg Loss',     '-$' + avgLoss.toFixed(2),         R],
    ['Consistency',  fPct(consistency * 100),           grc(consistency - .5)],
  ].map(([l, v, c]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:11px;color:var(--muted)">${l}</span>
      <span style="font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;color:${c};font-weight:700">${v}</span>
    </div>`).join('');

  const streakBadge = currentStreak >= 2 ? `
    <div style="display:inline-flex;align-items:center;gap:7px;background:${currentStreakDir === 'W' ? 'rgba(25,195,125,.1)' : 'rgba(240,81,101,.1)'};border:1px solid ${currentStreakDir === 'W' ? 'rgba(25,195,125,.3)' : 'rgba(240,81,101,.3)'};border-radius:6px;padding:5px 12px;font-size:12px;font-weight:700;color:${currentStreakDir === 'W' ? G : R};margin-bottom:16px">
      <i class="fa-solid ${currentStreakDir === 'W' ? 'fa-fire' : 'fa-snowflake'}"></i>
      Currently on a ${currentStreak}-trade ${currentStreakDir === 'W' ? 'WIN' : 'LOSS'} streak
    </div>` : '';

  return `
  <style>
    .ins-grid{display:grid;grid-template-columns:300px 1fr;gap:16px}
    .ins-findings{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
    @media(max-width:1023px){.ins-grid{grid-template-columns:1fr}.ins-findings{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:540px){.ins-findings{grid-template-columns:1fr 1fr}}
  </style>

  ${streakBadge}

  <div class="card" style="margin-bottom:16px;border-left:3px solid ${scoreColor}">
    <div style="display:flex;align-items:flex-start;gap:14px">
      <div style="width:36px;height:36px;border-radius:10px;background:rgba(25,195,125,.1);border:1px solid rgba(25,195,125,.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px">
        <i class="fa-solid fa-brain" style="color:${G};font-size:15px"></i>
      </div>
      <div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;font-weight:700;margin-bottom:8px">AI Performance Summary · ${vld.length} trades analyzed</div>
        <div style="font-size:13px;color:var(--text);line-height:1.75">${narrative}</div>
      </div>
    </div>
  </div>

  ${findings.length ? `
  <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;font-weight:700;margin-bottom:10px">Key Findings</div>
  <div class="ins-findings">${findingsHtml}</div>` : ''}

  <div class="ins-grid">

    <div style="display:flex;flex-direction:column;gap:16px">

      <div class="card">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:16px">
          <span style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;font-weight:700">Risk Score</span>
          <span class="sec-tip" data-tip="Composite 0–100 score across win rate (25%), profit factor (25%), max drawdown (25%), and day-to-day consistency (25%). Above 70 = Low Risk. 50–70 = Medium. Below 50 = High Risk.">?</span>
        </div>
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
          ${scoreGaugeHtml}
          <div>
            <div style="font-weight:700;font-size:16px;color:${scoreColor};margin-bottom:4px">${level}</div>
            <div style="font-size:11px;color:var(--muted);line-height:1.5">Based on ${vld.length} trade${vld.length !== 1 ? 's' : ''} across ${dayCount} day${dayCount !== 1 ? 's' : ''}</div>
            ${momData ? `<div style="font-size:11px;margin-top:6px;color:${momImproving ? G : R}"><i class="fa-solid fa-arrow-${momImproving ? 'up' : 'down'}" style="font-size:9px"></i> ${momImproving ? 'Improving' : 'Declining'} vs last month</div>` : ''}
          </div>
        </div>
        ${miniMetrics}
      </div>

      <div class="card">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;font-weight:700;margin-bottom:14px">Performance Breakdown</div>
        ${radarHtml}
      </div>

      <div class="card" style="border-color:rgba(25,195,125,.2)">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px">
          <i class="fa-solid fa-crosshairs" style="color:${G};font-size:12px"></i>
          <span style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;font-weight:700">Focus This Week</span>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:12px">Top priorities based on your data</div>
        ${focusHtml}
      </div>

    </div>

    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div>
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;font-weight:700;margin-bottom:3px">Recommendations</div>
          <div style="font-size:11px;color:var(--muted)">${recs.length} action item${recs.length !== 1 ? 's' : ''} generated from your patterns</div>
        </div>
        <div style="display:flex;gap:8px;font-size:10px;color:var(--muted)">
          <span style="display:flex;align-items:center;gap:4px"><span style="width:7px;height:7px;border-radius:50%;background:${R};display:inline-block"></span>High</span>
          <span style="display:flex;align-items:center;gap:4px"><span style="width:7px;height:7px;border-radius:50%;background:${Y};display:inline-block"></span>Review</span>
          <span style="display:flex;align-items:center;gap:4px"><span style="width:7px;height:7px;border-radius:50%;background:${G};display:inline-block"></span>Strength</span>
        </div>
      </div>
      ${recsHtml}
    </div>

  </div>`;
}

function _anaHideLoading(){
  const overlay=document.getElementById('anaLoadingOverlay');
  if(overlay){overlay.classList?.add('hidden');overlay.style.opacity='0';overlay.style.visibility='hidden';setTimeout(()=>{overlay.style.display='none';},300);}
}

(async()=>{
  if(!jid){
    document.getElementById('skelView').style.display='none';
    document.getElementById('root').style.display='';
    document.getElementById('root').innerHTML='<div class="empty"><i class="fa-solid fa-chart-line"></i>No journal selected.</div>';
    document.body.style.visibility='visible';_anaHideLoading();return;
  }

  const raw=await getTrades(jid);
  const allTrades=raw.map(dbToTrade);
  const settings=await getJournalSettings(jid);
  const mc=settings?.mood_colors||{};

  document.getElementById('skelView').style.display='none';
  document.getElementById('root').style.display='';
  document.body.style.visibility='visible';
  _anaHideLoading();

  const{data:{user:authUser}}=await db.auth.getUser();
  let isPro=false;
  if(authUser){
    try{isPro=parent?._userIsPro||false;if(!isPro){const p=await getProfile(authUser.id);isPro=getSubscriptionStatus(p).isPro;}}
    catch(e){const p=await getProfile(authUser.id);isPro=getSubscriptionStatus(p).isPro;}
  }

  _chartDefaults();

  if(!allTrades.length){
    document.getElementById('root').innerHTML='<div class="empty"><i class="fa-solid fa-chart-line"></i>No trades yet.<br>Add trades in the Logs tab to see analytics.</div>';
    return;
  }

  let activeRange='all';
  let activeTab='overview';

  const root=document.getElementById('root');
  root.innerHTML=`
    <div class="page-hdr">
      <div>
        <div class="page-label">Trading Journal</div>
        <h1 class="page-title">Analytics</h1>
      </div>
      <div class="range-group">
        <button class="range-btn" data-range="7d" onclick="window._setRange('7d')">7D</button>
        <button class="range-btn" data-range="30d" onclick="window._setRange('30d')">30D</button>
        <button class="range-btn" data-range="90d" onclick="window._setRange('90d')">90D</button>
        <button class="range-btn active" data-range="all" onclick="window._setRange('all')">All</button>
      </div>
    </div>
    <div class="kpi-strip" id="kpiStrip"></div>
    <div id="insightBarWrap"></div>
    ${isPro?`
      <div class="tab-bar">
        <button class="tz-tab active" data-tab="overview" onclick="window._switchTab('overview')">Overview</button>
        <button class="tz-tab" data-tab="timing" onclick="window._switchTab('timing')">Timing</button>
        <button class="tz-tab" data-tab="assets" onclick="window._switchTab('assets')">Assets &amp; Behavior</button>
        <button class="tz-tab" data-tab="insights" onclick="window._switchTab('insights')">Insights</button>
      </div>
      <div id="tabContent"></div>
    `:`
      <div class="card" style="margin-bottom:16px" id="freeEqCard">
        <div class="sec-hdr"><div class="sec-hdr-l"><span class="sec-ico"><i class="fa-solid fa-chart-area"></i></span><span class="sec-ttl">Equity Curve</span><span class="sec-tip" data-tip="Cumulative P&amp;L plotted over time.each point is the running total after that trade. A rising line means you are growing; a falling line means drawdown.">?</span></div></div>
        <div style="height:260px;position:relative"><canvas id="eq-free"></canvas></div>
      </div>
      <div class="ad-slot" style="margin-bottom:16px" id="adSlot1">
        <div class="ad-slot-label">Advertisement</div>
        <div class="ad-slot-inner"><ins class="adsbygoogle" style="display:block;width:100%;min-height:70px" data-ad-client="ca-pub-XXXXXXXXXXXXXXXX" data-ad-slot="XXXXXXXXXX" data-ad-format="horizontal" data-full-width-responsive="true"></ins></div>
      </div>
      <div class="card" style="border-color:rgba(25,195,125,.2);background:linear-gradient(135deg,rgba(25,195,125,.03),var(--panel))">
        <div style="text-align:center;padding:20px 16px">
          <i class="fa-solid fa-lock" style="font-size:28px;color:var(--muted);opacity:.4;display:block;margin-bottom:12px"></i>
          <h3 style="font-family:var(--font-heading,'Space Grotesk',sans-serif);font-size:15px;font-weight:600;margin-bottom:8px;text-transform:none;letter-spacing:0;color:var(--text)">Advanced Analytics.Pro</h3>
          <p style="font-size:13px;color:var(--muted);line-height:1.6;max-width:420px;margin:0 auto 16px">Unlock Strategy PNL, Mood heatmaps, Hour analysis, Day-of-week breakdown, Long vs Short, and more.</p>
          <a href="/subscription" style="display:inline-flex;align-items:center;gap:7px;background:#19c37d;color:#0b0f0c;border:none;border-radius:var(--radius-md,8px);padding:10px 20px;font-family:var(--font-heading,'Space Grotesk',sans-serif);font-size:13px;font-weight:700;text-decoration:none;transition:opacity .2s" onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
            <i class="fa-solid fa-chevron-up"></i> Upgrade to Pro.$5/mo
          </a>
        </div>
      </div>
    `}
  `;

  if(!isPro){
    const adSlot=document.getElementById('adSlot1');
    if(adSlot)adSlot.style.display='block';
    try{(adsbygoogle=window.adsbygoogle||[]).push({});}catch(e){}
  }

  function getFiltered(){return filterByRange(allTrades,activeRange);}

  function renderTab(trades,stats){
    _destroyCharts();
    const el=document.getElementById('tabContent');
    if(!el)return;
    if(activeTab==='overview'){el.innerHTML=renderOverviewHtml(trades,stats);initOverviewCharts(trades,stats);}
    else if(activeTab==='timing'){el.innerHTML=renderTimingHtml(trades);initTimingCharts(trades);}
    else if(activeTab==='assets'){el.innerHTML=renderAssetsHtml(trades,mc);initAssetsCharts(trades);}
    else if(activeTab==='insights'){el.innerHTML=renderInsightsHtml(trades,stats);}
  }

  function fullRender(){
    const trades=getFiltered();
    const stats=computeStats(trades);
    renderKpiStrip(stats,document.getElementById('kpiStrip'));
    renderInsightBar(stats,document.getElementById('insightBarWrap'),isPro);
    if(isPro){
      renderTab(trades,stats);
    }else{
      _destroyCharts();
      window._eqChart=_makeEquityChart('eq-free',stats.sorted);
    }
  }

  window._setRange=function(range){
    activeRange=range;
    document.querySelectorAll('.range-btn').forEach(b=>b.classList.toggle('active',b.dataset.range===range));
    fullRender();
  };

  window._switchTab=function(tab){
    activeTab=tab;
    document.querySelectorAll('.tz-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    const trades=getFiltered();
    renderTab(trades,computeStats(trades));
  };

  fullRender();
})();

// Inline handlers in HTML call these by global name.
// No inline handlers detected.