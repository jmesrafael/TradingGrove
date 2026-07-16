// position-calculator.js - public risk calculator landing page
// Loaded by /src/pages/calculators/position-calculator.html.
// ══════════════════════════════════════════════════════════════════
//  CALCULATOR ENGINE — exact copy of journal.html calculator logic
// ══════════════════════════════════════════════════════════════════
const CALC_KEY='tradeCalcDefaults_v4';
let cAsset='crypto';
let cRiskMode='pct';
let cSlMode='price';
let cTpMode='price';
let fRiskMode='pct';
let fSlMode='pips';
let fTpMode='pips';

const CURRENCY_SYMBOLS={USD:'$',EUR:'€',GBP:'£',JPY:'¥',CHF:'Fr',AUD:'A$',CAD:'C$',NZD:'NZ$'};
const CONTRACT_SIZE=100000;
const APPROX_RATES={USD:1,EUR:1.08,GBP:1.27,JPY:0.0067,CHF:1.12,AUD:0.65,CAD:0.74,NZD:0.60};

function _getPipSize(pair){return pair.includes('JPY')?0.01:0.0001;}
function _getLotLabel(lots){if(lots>=0.9)return 'Standard lot'+(lots>=1.9?'s':'');if(lots>=0.09)return 'Mini lot'+(lots>=0.19?'s':'');return 'Micro lot'+(lots>=0.019?'s':'');}
function _getPipValuePerLot(pair,acctCcy,entryPrice){
  const pipSize=_getPipSize(pair);const pipValueInQuote=pipSize*CONTRACT_SIZE;
  let base,quote;
  const specials={XAUUSD:['XAU','USD'],XAGUSD:['XAG','USD'],US30:['US30','USD'],NAS100:['NAS100','USD']};
  if(specials[pair]){[base,quote]=specials[pair];}else{base=pair.slice(0,3);quote=pair.slice(3,6);}
  if(quote===acctCcy)return pipValueInQuote;
  if(base===acctCcy&&entryPrice>0)return pipValueInQuote/entryPrice;
  const quoteToUSD=APPROX_RATES[quote]||1;const acctToUSD=APPROX_RATES[acctCcy]||1;
  return pipValueInQuote*(quoteToUSD/acctToUSD);
}

function _fmtMoney(n,ccy='USD',d=2){if(n===null||n===undefined||isNaN(n))return'—';const sym=CURRENCY_SYMBOLS[ccy]||ccy+' ';return sym+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});}
function _fmtUSD(n,d=2){return _fmtMoney(n,'USD',d);}
function _fmt(n,d=2){if(n===null||n===undefined||isNaN(n))return'—';return n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});}
function _sv(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function _rrColor(rr){if(rr>=3)return'#00c896';if(rr>=2)return _lerpHex('#f59e0b','#00c896',rr-2);if(rr>=1)return _lerpHex('#ff4f6a','#f59e0b',rr-1);return'#ff4f6a';}
function _lerpHex(a,b,t){const ah=parseInt(a.slice(1),16),bh=parseInt(b.slice(1),16);const[ar,ag,ab_]=[(ah>>16)&0xff,(ah>>8)&0xff,ah&0xff];const[br,bg,bb]=[(bh>>16)&0xff,(bh>>8)&0xff,bh&0xff];const r=Math.round(ar+(br-ar)*t),g=Math.round(ag+(bg-ag)*t),b2=Math.round(ab_+(bb-ab_)*t);return'#'+[r,g,b2].map(x=>x.toString(16).padStart(2,'0')).join('');}

function _updateRR(rr){
  if(rr===null||isNaN(rr)||rr<=0){document.getElementById('cRrSection').style.display='none';return;}
  document.getElementById('cRrSection').style.display='block';
  const col=_rrColor(rr),rrEl=document.getElementById('cRrVal');
  rrEl.textContent='1 : '+_fmt(rr,2);rrEl.style.color=col;
  const fill=document.getElementById('cRrFill');
  fill.style.width=Math.min((rr/3)*100,100)+'%';
  fill.style.background=rr>=3?'#00c896':`linear-gradient(to right, #ff4f6a, ${_rrColor(rr)})`;
}

function cSetAsset(t){
  cAsset=t;
  document.getElementById('cBtnCrypto').classList.toggle('active',t==='crypto');
  document.getElementById('cBtnForex').classList.toggle('active',t==='forex');
  document.getElementById('cryptoInputs').style.display=t==='crypto'?'':'none';
  document.getElementById('forexInputs').style.display=t==='forex'?'':'none';
  document.getElementById('cCryptoResults').style.display=t==='crypto'?'':'none';
  document.getElementById('cForexResults').style.display=t==='forex'?'':'none';
  const acctCcy=document.getElementById('cAcctCurrency')?.value||'USD';
  const pre=document.getElementById('fBalancePre');if(pre)pre.textContent=CURRENCY_SYMBOLS[acctCcy]||'$';
  cCalc();
}

function cSetRiskMode(m){
  cRiskMode=m;
  document.getElementById('cRiskPctBtn').classList.toggle('active',m==='pct');
  document.getElementById('cRiskUsdBtn').classList.toggle('active',m==='usd');
  document.getElementById('cRiskSuf').textContent=m==='pct'?'%':'$';
  cCalc();
}
function cSetSlMode(m){
  cSlMode=m;
  document.getElementById('cSlPriceBtn').classList.toggle('active',m==='price');
  document.getElementById('cSlPctBtn').classList.toggle('active',m==='pct');
  document.getElementById('cSlPriceWrap').style.display=m==='price'?'':'none';
  document.getElementById('cSlPctWrap').style.display=m==='pct'?'':'none';
  cCalc();
}
function cSetTpMode(m){
  cTpMode=m;
  document.getElementById('cTpPriceBtn').classList.toggle('active',m==='price');
  document.getElementById('cTpPctBtn').classList.toggle('active',m==='pct');
  document.getElementById('cTpPriceWrap').style.display=m==='price'?'':'none';
  document.getElementById('cTpPctWrap').style.display=m==='pct'?'':'none';
  cCalc();
}
function fSetRiskMode(m){
  fRiskMode=m;
  document.getElementById('fRiskPctBtn').classList.toggle('active',m==='pct');
  document.getElementById('fRiskUsdBtn').classList.toggle('active',m==='usd');
  document.getElementById('fRiskSuf').textContent=m==='pct'?'%':(CURRENCY_SYMBOLS[document.getElementById('cAcctCurrency')?.value||'USD']||'$');
  cCalc();
}
function fSetSlMode(m){
  fSlMode=m;
  document.getElementById('fSlPipsBtn').classList.toggle('active',m==='pips');
  document.getElementById('fSlPriceBtn2').classList.toggle('active',m==='price');
  document.getElementById('fSlPipsWrap').style.display=m==='pips'?'':'none';
  document.getElementById('fSlPriceWrap2').style.display=m==='price'?'':'none';
  cCalc();
}
function fSetTpMode(m){
  fTpMode=m;
  document.getElementById('fTpPipsBtn').classList.toggle('active',m==='pips');
  document.getElementById('fTpPriceBtn2').classList.toggle('active',m==='price');
  document.getElementById('fTpPipsWrap').style.display=m==='pips'?'':'none';
  document.getElementById('fTpPriceWrap2').style.display=m==='price'?'':'none';
  cCalc();
}

function cLoadDefaults(){
  try{
    const d=JSON.parse(localStorage.getItem(CALC_KEY));
    if(!d)return;
    if(d.capital!==undefined)document.getElementById('cCapital').value=d.capital;
    if(d.riskVal!==undefined)document.getElementById('cRiskVal').value=d.riskVal;
    if(d.riskMode!==undefined)cSetRiskMode(d.riskMode);
    if(d.leverage!==undefined)document.getElementById('cLeverage').value=d.leverage;
    if(d.asset!==undefined)cSetAsset(d.asset);
  }catch(e){}
}

function cSaveDefault(){
  const d={
    capital:document.getElementById('cCapital').value,
    riskVal:document.getElementById('cRiskVal').value,
    riskMode:cRiskMode,
    leverage:document.getElementById('cLeverage').value,
    asset:cAsset
  };
  localStorage.setItem(CALC_KEY,JSON.stringify(d));
  const btn=document.getElementById('cBtnSetDef'),fb=document.getElementById('cSaveFeedback');
  btn.classList.add('saved');fb.classList.add('show');
  setTimeout(()=>{btn.classList.remove('saved');fb.classList.remove('show');},2000);
}

function cCalc(){if(cAsset==='crypto')_calcCrypto();else _calcForex();}

function _calcCrypto(){
  const capital=parseFloat(document.getElementById('cCapital').value);
  const riskVal=parseFloat(document.getElementById('cRiskVal').value);
  const entry=parseFloat(document.getElementById('cEntry').value);
  const leverage=Math.max(1,parseFloat(document.getElementById('cLeverage').value)||1);
  _sv('cLevDisplay',leverage+'×');
  let riskAmt=null;
  if(!isNaN(capital)&&capital>0&&!isNaN(riskVal)&&riskVal>0)
    riskAmt=cRiskMode==='pct'?capital*(riskVal/100):riskVal;
  let slDist=null,slPct=null;
  if(!isNaN(entry)&&entry>0){
    if(cSlMode==='price'){const slP=parseFloat(document.getElementById('cSLPrice').value);if(!isNaN(slP)&&slP>0&&slP!==entry){slDist=Math.abs(entry-slP);slPct=(slDist/entry)*100;}}
    else{const sp=parseFloat(document.getElementById('cSLPct').value);if(!isNaN(sp)&&sp>0){slPct=sp;slDist=entry*(sp/100);}}
  }
  let tpDist=null,tpPct=null;
  if(!isNaN(entry)&&entry>0){
    if(cTpMode==='price'){const tpP=parseFloat(document.getElementById('cTPPrice').value);if(!isNaN(tpP)&&tpP>0&&tpP!==entry){tpDist=Math.abs(tpP-entry);tpPct=(tpDist/entry)*100;}}
    else{const tp=parseFloat(document.getElementById('cTPPct').value);if(!isNaN(tp)&&tp>0){tpPct=tp;tpDist=entry*(tp/100);}}
  }
  if(riskAmt!==null&&slDist!==null&&slDist>0){
    const posSize=riskAmt/slDist,posVal=posSize*entry,margin=posVal/leverage,profit=tpDist!==null?posSize*tpDist:null,rr=profit!==null?profit/riskAmt:null;
    _sv('cOutRisk',_fmtUSD(riskAmt));
    const riskSubParts=[];
    if(cRiskMode==='pct')riskSubParts.push(riskVal.toFixed(2)+'% of capital');
    else riskSubParts.push('fixed risk');
    if(slPct)riskSubParts.push('SL '+slPct.toFixed(3)+'% away');
    _sv('cOutRiskSub',riskSubParts.join(' · '));
    if(profit!==null){
      document.getElementById('cProfitCard').style.opacity='1';
      _sv('cOutProfit',_fmtUSD(profit));
      _sv('cOutProfitSub',tpPct?'TP '+tpPct.toFixed(3)+'% from entry':'if TP hit');
    }else{
      document.getElementById('cProfitCard').style.opacity='.35';
      _sv('cOutProfit','—');
      _sv('cOutProfitSub','set a take profit to calculate');
    }
    _sv('cOutMargin',_fmtUSD(margin));
    if(leverage>1){
      _sv('cOutMarginSub',`Position: ${_fmtUSD(posVal)} · ${leverage}× leverage`);
      document.getElementById('cLevNote').style.display='block';
      _sv('cLevNoteX',leverage+'×');
      _sv('cLevNotePos',_fmtUSD(posVal));
      _sv('cLevNoteMargin',_fmtUSD(margin));
    }else{
      _sv('cOutMarginSub',`Full position: ${_fmtUSD(posVal)}`);
      document.getElementById('cLevNote').style.display='none';
    }
    _updateRR(rr);
  }else{
    _cryptoClear();
  }
}

function _cryptoClear(){
  _sv('cOutRisk','—');_sv('cOutRiskSub','if stop loss is hit');
  _sv('cOutProfit','—');_sv('cOutProfitSub','set a take profit to calculate');
  _sv('cOutMargin','—');_sv('cOutMarginSub','enter trade details to calculate');
  document.getElementById('cProfitCard').style.opacity='.35';
  document.getElementById('cLevNote').style.display='none';
  _sv('cLevDisplay',(parseFloat(document.getElementById('cLeverage').value)||1)+'×');
  _updateRR(null);
}

function _calcForex(){
  const pair=document.getElementById('cPair').value||'EURUSD';
  const acctCcy=document.getElementById('cAcctCurrency').value||'USD';
  const balance=parseFloat(document.getElementById('cFBalance').value);
  const riskInput=parseFloat(document.getElementById('cFRisk').value);
  const entryRaw=parseFloat(document.getElementById('cFEntry').value);
  const entry=!isNaN(entryRaw)&&entryRaw>0?entryRaw:0;
  const pre=document.getElementById('fBalancePre');if(pre)pre.textContent=CURRENCY_SYMBOLS[acctCcy]||'$';
  if(isNaN(balance)||balance<=0||isNaN(riskInput)||riskInput<=0){_forexClear();return;}
  const riskAmt=fRiskMode==='pct'?balance*(riskInput/100):riskInput;
  const pipSize=_getPipSize(pair);
  let slPips=null;
  if(fSlMode==='pips'){const p=parseFloat(document.getElementById('cFSLPips').value);if(!isNaN(p)&&p>0)slPips=p;}
  else{const slPrice=parseFloat(document.getElementById('cFSLPrice').value);if(!isNaN(slPrice)&&slPrice>0&&entry>0&&slPrice!==entry)slPips=Math.abs(entry-slPrice)/pipSize;}
  let tpPips=null;
  if(fTpMode==='pips'){const p=parseFloat(document.getElementById('cFTPPips').value);if(!isNaN(p)&&p>0)tpPips=p;}
  else{const tpPrice=parseFloat(document.getElementById('cFTPPrice').value);if(!isNaN(tpPrice)&&tpPrice>0&&entry>0&&tpPrice!==entry)tpPips=Math.abs(tpPrice-entry)/pipSize;}
  if(slPips===null||slPips<=0){_forexClear();return;}
  const pipValPerLot=_getPipValuePerLot(pair,acctCcy,entry);
  const lots=riskAmt/(slPips*pipValPerLot),units=lots*CONTRACT_SIZE;
  const moneyAtRisk=lots*slPips*pipValPerLot;
  let tpProfit=null,rr=null;
  if(tpPips!==null&&tpPips>0){tpProfit=lots*tpPips*pipValPerLot;rr=tpPips/slPips;}
  const pipValTotal=lots*pipValPerLot;
  const sym=CURRENCY_SYMBOLS[acctCcy]||'$';
  const fmtA=(n,d=2)=>n===null||isNaN(n)?'—':sym+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
  _sv('fOutRiskAmt',fmtA(moneyAtRisk));
  _sv('fOutRiskPct',fRiskMode==='pct'?riskInput.toFixed(2)+'% of balance':'fixed risk');
  const lotsRounded=Math.round(lots*100)/100;
  _sv('fOutLots',_fmt(lotsRounded,lotsRounded<0.01?4:lotsRounded<0.1?3:2));
  _sv('fOutLotType',_getLotLabel(lotsRounded));
  _sv('fOutUnits',Math.round(units).toLocaleString('en-US'));
  _sv('fOutPipVal',fmtA(pipValPerLot,pipValPerLot<1?3:2));
  _sv('fOutPipValSub','per pip · 1 std lot');
  const slInfoEl=document.getElementById('fSlInfo');if(slInfoEl)slInfoEl.style.display='';
  _sv('fOutSlPips',_fmt(slPips,slPips%1===0?0:1));
  _sv('fOutPipSize',pipSize===0.0001?'0.0001':'0.01');
  _sv('fOutContract',CONTRACT_SIZE.toLocaleString('en-US'));
  if(tpProfit!==null){
    document.getElementById('fPnlSec').style.display='';
    _sv('fOutProfit',fmtA(tpProfit));
    _sv('fOutProfitPips',_fmt(tpPips,tpPips%1===0?0:1)+' pips');
    _sv('fOutPipValTotal',fmtA(pipValTotal,pipValTotal<1?3:2));
  }else{
    document.getElementById('fPnlSec').style.display='none';
  }
  _updateRR(rr);
}

function _forexClear(){
  ['fOutRiskAmt','fOutRiskPct','fOutLots','fOutLotType','fOutUnits','fOutPipVal','fOutPipValSub','fOutSlPips','fOutPipSize'].forEach(k=>_sv(k,'—'));
  const slInfoEl=document.getElementById('fSlInfo');if(slInfoEl)slInfoEl.style.display='none';
  document.getElementById('fPnlSec').style.display='none';
  _updateRR(null);
}

document.getElementById('cAcctCurrency')?.addEventListener('change',()=>{
  const acctCcy=document.getElementById('cAcctCurrency').value;
  const pre=document.getElementById('fBalancePre');if(pre)pre.textContent=CURRENCY_SYMBOLS[acctCcy]||'$';
  if(fRiskMode==='usd'){const suf=document.getElementById('fRiskSuf');if(suf)suf.textContent=CURRENCY_SYMBOLS[acctCcy]||'$';}
  cCalc();
});

// ── FAQ accordion ──
function toggleFaq(el){
  const item=el.closest('.faq-item');
  const wasOpen=item.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(i=>i.classList.remove('open'));
  if(!wasOpen)item.classList.add('open');
}

// ── Nav: Tools dropdown ──
function toggleToolsDropdown(){
  document.getElementById('toolsDropdown').classList.toggle('open');
}
document.addEventListener('click',function(e){
  const dd=document.getElementById('toolsDropdown');
  if(dd&&!dd.contains(e.target))dd.classList.remove('open');
});

// ── Nav: Mobile ──
function toggleMobileNav(){
  document.getElementById('mobileNav').classList.toggle('open');
  document.getElementById('navHamburger').classList.toggle('open');
}
function closeMobileNav(){
  document.getElementById('mobileNav').classList.remove('open');
  document.getElementById('navHamburger').classList.remove('open');
}
window.addEventListener('scroll',()=>{
  if(document.getElementById('mobileNav').classList.contains('open'))closeMobileNav();
},{passive:true});

// ── Auto-switch to Forex if hash is #forex ──
if(window.location.hash==='#forex')cSetAsset('forex');

// Inline handlers in HTML call these by global name.
Object.assign(window, { cCalc, closeMobileNav, cSaveDefault, cSetAsset, cSetRiskMode, cSetSlMode, cSetTpMode, fSetRiskMode, fSetSlMode, fSetTpMode, toggleFaq, toggleMobileNav, toggleToolsDropdown });