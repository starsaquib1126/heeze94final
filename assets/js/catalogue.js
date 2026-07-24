/* ═══ HEEZE 94 · catalogue.js · v4 · Real Assets ════════════════════════════ */
const H94 = (() => {

const DEFAULT = [
  { id:'black-oud', name:'Black Oud', family:'Oud · Intense', featured:true, category:'oud',
    img:'assets/Attar/black-oud.jpg',
    desc:'The most intense expression of the house. Opens with dark smoked agarwood, settling into a leathered resin warmth that stays close to the skin for hours.',
    notes:{Top:'Smoked agarwood',Heart:'Dark resin, leather accord',Base:'Deep woods, warm musk'},
    sizes:[{ml:3,price:499},{ml:6,price:899},{ml:12,price:1499}]},
  { id:'golden-oud', name:'Golden Oud', family:'Oud · Amber', featured:true, category:'oud',
    img:'assets/Attar/golden-oud.jpg',
    desc:'Oud in its most luminous form. Radiant agarwood with golden amber and a trace of saffron honey — regal, warm and unmistakably HEEZE 94.',
    notes:{Top:'Saffron, golden honey',Heart:'Radiant oud',Base:'Golden amber, soft woods'},
    sizes:[{ml:3,price:499},{ml:6,price:899},{ml:12,price:1499}]},
  { id:'rose-musk', name:'Rose Musk', family:'Floral · Musk', featured:true, category:'musk',
    img:'assets/Attar/rose-musk.jpg',
    desc:'A romance in oil form. Velvet rose petals wrapped in soft white musk — tender at first, then quietly magnetic on the skin.',
    notes:{Top:'Fresh rose petals',Heart:'Velvet damask rose',Base:'Soft white musk'},
    sizes:[{ml:3,price:399},{ml:6,price:749},{ml:12,price:1299}]}
];

function getCat(){ return DEFAULT; } /* catalogue is code-defined; localStorage cache removed permanently */
function saveCat(c){ /* disabled — old h94_cat cache caused stale images */ }
try{ localStorage.removeItem('h94_cat'); }catch(e){}

/* ── Cart ── */
let cart={};
try{ cart=JSON.parse(localStorage.getItem('h94_cart')||'{}'); }catch(e){}
const saveCart=()=>localStorage.setItem('h94_cart',JSON.stringify(cart));
const fmt=n=>'₹'+Number(n).toLocaleString('en-IN');

function addToCart(id,ml,qty=1){
  const key=id+'|'+ml;
  cart[key]=(cart[key]||0)+qty;
  saveCart(); renderCart(); showToast('Added to your bag');
}
function changeQty(key,d){
  cart[key]=(cart[key]||0)+d;
  if(cart[key]<=0)delete cart[key];
  saveCart(); renderCart();
}
function lineInfo(key){
  const [id,ml]=key.split('|');
  const p=getCat().find(x=>x.id===id);
  const s=p&&p.sizes.find(x=>x.ml===+ml);
  return {p,s};
}

/* ── Cart UI ── */
function renderCart(){
  const items=Object.entries(cart);
  const count=items.reduce((s,[,q])=>s+q,0);
  document.querySelectorAll('[data-bag-count]').forEach(el=>el.textContent=count);
  const wrap=document.querySelector('[data-cart-items]');
  if(!wrap)return;
  if(!items.length){
    wrap.innerHTML='<p class="cart-empty">Your bag awaits its first fragrance.</p>';
  }else{
    wrap.innerHTML=items.map(([key,q])=>{
      const {p,s}=lineInfo(key);
      if(!p||!s)return'';
      return`<div class="cart-line">
        <div class="cl-info"><strong>${p.name}</strong><span>${s.ml} ml · Attar</span></div>
        <div class="cl-qty">
          <button onclick="H94.changeQty('${key}',-1)">−</button><span>${q}</span>
          <button onclick="H94.changeQty('${key}',1)">+</button>
        </div>
        <div class="cl-price">${fmt(s.price*q)}</div>
      </div>`;
    }).join('');
  }
  const total=items.reduce((s,[key,q])=>{const{s:sz}=lineInfo(key);return s+(sz?sz.price*q:0);},0);
  const el=document.querySelector('[data-cart-total]');
  if(el)el.textContent=fmt(total);
}
function openCart(){document.body.classList.add('cart-open');renderCart();}
function closeCart(){document.body.classList.remove('cart-open');}

/* ── Toast ── */
function showToast(msg){
  const t=document.querySelector('.toast');
  if(!t)return;
  t.textContent=msg;t.classList.add('show');
  clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),2200);
}

/* ── Grids ── */
function renderGrid(container,opts={}){
  let products=getCat();
  if(opts.featuredOnly)products=products.filter(p=>p.featured);
  if(opts.category)products=products.filter(p=>p.category===opts.category);
  if(opts.limit)products=products.slice(0,+opts.limit);
  if(!products.length){container.innerHTML='<p class="no-products">No fragrances found.</p>';return;}
  container.innerHTML=products.map(p=>`
    <article class="product-card" onclick="location.href='product.html?id=${p.id}'" tabindex="0">
      <div class="product-img-wrap">
        <img src="${p.img}" alt="${p.name} attar" loading="lazy"/>
      </div>
      <div class="product-info">
        <div class="eyebrow">${p.family}</div>
        <h3>${p.name}</h3>
        <p class="product-short">${(p.desc||'').substring(0,82)}…</p>
        <div class="product-price">From ${fmt(Math.min(...p.sizes.map(s=>s.price)))} <span>· 3 · 6 · 12 ml</span></div>
      </div>
    </article>`).join('');
}

/* ── Ticker ── */
function initTicker(){
  const t=document.querySelector('.ticker-track');
  if(!t)return;
  const labels=getCat().map(p=>`<span>${p.name} <b>◆</b></span>`).join(' ');
  t.innerHTML=labels+' '+labels;
}

/* ── Reveals ── */
function initReveals(){
  const io=new IntersectionObserver(entries=>{
    entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});
  },{threshold:.1});
  document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
}

/* ── Year ── */
function initYear(){
  document.querySelectorAll('[data-year]').forEach(el=>el.textContent=new Date().getFullYear());
}

/* ── Mobile menu ── */
function initMenu(){
  const toggle=document.querySelector('.menu-toggle');
  const menu=document.querySelector('.mobile-menu');
  if(toggle&&menu)toggle.addEventListener('click',()=>menu.classList.toggle('open'));
}

/* ── Video play/pause ── */
function initVideos(){
  // Auto-play muted hero video
  document.querySelectorAll('video[data-autoplay]').forEach(v=>{
    v.muted=true;v.loop=true;v.playsInline=true;
    v.play().catch(()=>{});
  });
  // Control button
  const ctrl=document.querySelector('[data-video-ctrl]');
  const heroVid=document.getElementById('heroVideo');
  if(ctrl&&heroVid){
    const span=ctrl.querySelector('span[data-state]');
    ctrl.addEventListener('click',()=>{
      if(heroVid.paused){heroVid.play();if(span)span.textContent='Pause';}
      else{heroVid.pause();if(span)span.textContent='Play';}
    });
  }
}

/* ── Filters ── */
function initFilters(){
  document.querySelectorAll('.filter').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.filter').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const grid=document.querySelector('[data-product-grid]');
      if(!grid)return;
      const f=btn.dataset.filter;
      renderGrid(grid,f==='all'?{}:{category:f});
    });
  });
}

/* ── DOMContentLoaded init ── */
document.addEventListener('DOMContentLoaded',()=>{
  initYear();initReveals();initMenu();initTicker();initFilters();initVideos();
  document.querySelectorAll('[data-product-grid]').forEach(el=>{
    renderGrid(el,{
      featuredOnly:el.dataset.featuredOnly==='true',
      limit:el.dataset.limit,
      category:el.dataset.category
    });
  });
  document.querySelector('[data-open-cart]')?.addEventListener('click',openCart);
  document.querySelector('[data-close-cart]')?.addEventListener('click',closeCart);
  document.querySelector('.cart-veil')?.addEventListener('click',closeCart);
  document.querySelector('[data-checkout]')?.addEventListener('click',()=>{
    const count=Object.values(cart).reduce((s,q)=>s+q,0);
    if(!count){showToast('Your bag is empty');return;}
    showToast('Razorpay checkout connects here once your account is live');
  });
  renderCart();
  // Mark active nav link
  const path=location.pathname.split('/').pop()||'index.html';
  document.querySelectorAll('.nav-links a').forEach(a=>{
    const href=a.getAttribute('href');
    if(href&&(href===path||href.replace('.html','')==='/'+path.replace('.html',''))){
      a.classList.add('active');
    }
  });
});

return {addToCart,changeQty,openCart,closeCart,getCat,saveCat,fmt,showToast,renderGrid};
})();
