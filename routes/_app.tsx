import { define } from "../utils.ts";

/** Open Graph / social crawlers prefer absolute image URLs. Set FRESH_PUBLIC_SITE_URL on Deno Deploy (e.g. https://atmosphereaccount.com). */
function socialImageUrl(path: string): string {
  const base = Deno.env.get("FRESH_PUBLIC_SITE_URL")?.replace(/\/$/, "");
  if (base) return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return path;
}

const inlineScript = `
(function(){
  /* ---- Scroll reveal ---- */
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting) e.target.classList.add('visible');
    });
  },{threshold:0.12});
  document.querySelectorAll('.reveal').forEach(function(el){io.observe(el);});

  /* ---- Lottie play/pause on scroll visibility ---- */
  var lottieIo = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      var lp = e.target;
      try {
        if(e.isIntersecting){ lp.play && lp.play(); }
        else { lp.pause && lp.pause(); }
      } catch(_){}
    });
  },{threshold:0.15});
  document.querySelectorAll('lottie-player').forEach(function(el){ lottieIo.observe(el); });

  var nav = document.getElementById('main-nav');

  /* ---- Sky gradient: starts DAY, cycles day->sunset->night->sunrise->day ---- */
  var K = [
    {p:0,    c:['#e8f0fe','#c9d8f5','#a8c4f0','#c0d4f5','#ebe4f5']},
    {p:0.12, c:['#e0e8f8','#c8d0e8','#b0c0e0','#c8c0d8','#e0d4e0']},
    {p:0.22, c:['#d08058','#d88868','#e87838','#f09848','#f0c870']},
    {p:0.32, c:['#301040','#4a1848','#882858','#c04860','#d87050']},
    {p:0.45, c:['#060510','#0a0f20','#0f1830','#152038','#0a0f1a']},
    {p:0.60, c:['#060510','#0a0f20','#0f1830','#152038','#0a0f1a']},
    {p:0.72, c:['#1a0a2e','#381540','#703050','#b86060','#e0a070']},
    {p:0.84, c:['#c08070','#d8a888','#e0c8b0','#e8dcd0','#f0e8e0']},
    {p:1,    c:['#e8f0fe','#c9d8f5','#a8c4f0','#c0d4f5','#ebe4f5']}
  ];

  function h2r(h){var r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16);return[r,g,b];}
  function mx(a,b,t){return[Math.round(a[0]+(b[0]-a[0])*t),Math.round(a[1]+(b[1]-a[1])*t),Math.round(a[2]+(b[2]-a[2])*t)];}
  function rg(c){return'rgb('+c[0]+','+c[1]+','+c[2]+')';}
  function sm(t){return t*t*(3-2*t);}

  function findSeg(p){for(var j=0;j<K.length-1;j++){if(p>=K[j].p&&p<=K[j+1].p)return j;}return 0;}

  function gradient(p){
    var i=findSeg(p);
    var t=sm((p-K[i].p)/(K[i+1].p-K[i].p));
    var c=[];for(var k=0;k<5;k++)c.push(rg(mx(h2r(K[i].c[k]),h2r(K[i+1].c[k]),t)));
    return'linear-gradient(180deg,'+c[0]+' 0%,'+c[1]+' 25%,'+c[2]+' 50%,'+c[3]+' 75%,'+c[4]+' 100%)';
  }

  function luminance(p){
    var i=findSeg(p);var t=sm((p-K[i].p)/(K[i+1].p-K[i].p));
    var m=mx(h2r(K[i].c[2]),h2r(K[i+1].c[2]),t);
    return(m[0]*0.299+m[1]*0.587+m[2]*0.114)/255;
  }

  /* ---- Sun glow + rays elements ---- */
  var layer=document.querySelector('.cloud-layer');
  var sunEl=document.createElement('div');
  sunEl.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;backface-visibility:hidden;transform:translateZ(0);';
  var raysEl=document.createElement('div');
  /* soft-light is less prone to full-viewport seam artifacts than screen while scrolling */
  raysEl.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;mix-blend-mode:soft-light;backface-visibility:hidden;transform:translateZ(0);';
  if(layer){
    layer.parentNode.insertBefore(sunEl,layer);
    layer.parentNode.insertBefore(raysEl,layer);
  }

  /* ---- Cloud parallax setup ---- */
  var svgs=document.querySelectorAll('.cloud-svg');
  var cData=[];
  svgs.forEach(function(el){
    cData.push({el:el,speed:parseFloat(el.dataset.speed)||0,flip:el.dataset.flip==='1'});
  });

  /* ---- Main scroll update ---- */
  var ticking=false;
  function update(){
    var scrollY=window.scrollY;
    var maxScroll=Math.max(1,document.documentElement.scrollHeight-window.innerHeight);
    var p=Math.min(1,Math.max(0,scrollY/maxScroll));

    document.body.style.background=gradient(p);

    var lum=luminance(p);
    document.body.classList.toggle('dark-phase',lum<0.45);

    /* ---- Sun arc: noon at p=0, sunset right, midnight below, sunrise left ---- */
    var ang=2*Math.PI*p;
    var sunX=50+65*Math.sin(ang);
    var sunY=40-58*Math.cos(ang);

    /* Visibility: 1 at highest point, fades toward horizon */
    var vis=Math.max(0,Math.min(1,(52-sunY)/65));

    /* Color temperature: warm gold when low, bright yellow-white when high */
    var ht=Math.max(0,Math.min(1,(25-sunY)/55));
    var sr=255;
    var sg=Math.round(185+ht*55);
    var sb=Math.round(60+ht*140);

    var op=vis*0.6;
    var sz=50+vis*30;

    /* Primary glow: large warm radial from sun position */
    if(vis>0.005){
      sunEl.style.background=
        'radial-gradient(ellipse '+sz+'% '+sz+'% at '+sunX+'% '+sunY+'%,'+
          'rgba('+sr+','+sg+','+sb+','+op.toFixed(3)+') 0%,'+
          'rgba('+sr+','+sg+','+sb+','+(op*0.45).toFixed(3)+') 20%,'+
          'rgba('+sr+','+sg+','+sb+','+(op*0.15).toFixed(3)+') 45%,'+
          'transparent 70%),'+
        'radial-gradient(ellipse '+(sz*1.8)+'% '+(sz*1.8)+'% at '+sunX+'% '+sunY+'%,'+
          'rgba('+sr+','+sg+','+sb+','+(op*0.1).toFixed(3)+') 0%,'+
          'transparent 60%)';

      /* God rays: conic gradient beams radiating from sun */
      var rayOp=vis*0.18;
      var rayC='rgba('+sr+','+sg+','+sb+',';
      raysEl.style.background=
        'conic-gradient(from 0deg at '+sunX+'% '+sunY+'%,'+
          rayC+rayOp.toFixed(3)+') 0deg,'+
          'transparent 8deg,'+
          'transparent 25deg,'+
          rayC+(rayOp*0.7).toFixed(3)+') 30deg,'+
          'transparent 38deg,'+
          'transparent 60deg,'+
          rayC+(rayOp*0.9).toFixed(3)+') 65deg,'+
          'transparent 75deg,'+
          'transparent 100deg,'+
          rayC+(rayOp*0.6).toFixed(3)+') 105deg,'+
          'transparent 115deg,'+
          'transparent 140deg,'+
          rayC+(rayOp*0.8).toFixed(3)+') 148deg,'+
          'transparent 158deg,'+
          'transparent 185deg,'+
          rayC+(rayOp*0.5).toFixed(3)+') 190deg,'+
          'transparent 200deg,'+
          'transparent 225deg,'+
          rayC+(rayOp*0.7).toFixed(3)+') 232deg,'+
          'transparent 242deg,'+
          'transparent 270deg,'+
          rayC+(rayOp*0.6).toFixed(3)+') 278deg,'+
          'transparent 288deg,'+
          'transparent 315deg,'+
          rayC+(rayOp*0.8).toFixed(3)+') 322deg,'+
          'transparent 332deg,'+
          'transparent 355deg,'+
          rayC+(rayOp*0.4).toFixed(3)+') 360deg)';
      raysEl.style.opacity=vis;
    } else {
      sunEl.style.background='none';
      raysEl.style.opacity='0';
    }

    /* Cloud parallax + sun-lit highlight on each cloud */
    for(var i=0;i<cData.length;i++){
      var d=cData[i];
      var ty=scrollY*d.speed;
      d.el.style.transform='translate3d(0,'+ty+'px,0)'+(d.flip?' scaleX(-1)':'');
    }

    if(nav){
      if(scrollY>40)nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
    }
    ticking=false;
  }

  window.addEventListener('scroll',function(){
    if(!ticking){ticking=true;requestAnimationFrame(update);}
  },{passive:true});
  update();
})();
`;

export default define.page(function App({ Component }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>
          Atmosphere Account — The last social account you'll ever need.
        </title>
        <meta
          name="description"
          content="Your Atmosphere account is your passport to a growing ecosystem of apps. One account, all your data, your choice."
        />
        <meta property="og:title" content="Atmosphere Account" />
        <meta
          property="og:description"
          content="The last social account you'll ever need. One account for all your apps."
        />
        <meta property="og:type" content="website" />
        <meta property="og:image" content={socialImageUrl("/union.svg")} />
        <meta property="og:image:type" content="image/svg+xml" />
        <meta
          property="og:image:alt"
          content="Atmosphere Account — logo"
        />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content={socialImageUrl("/union.svg")} />
        <link rel="icon" type="image/svg+xml" href="/union.svg" />
        <link rel="apple-touch-icon" href="/union.svg" />
        <script
          src="https://unpkg.com/@lottiefiles/lottie-player@2.0.8/dist/lottie-player.js"
          defer
        />
      </head>
      <body class="sky-bg">
        <Component />
        <script dangerouslySetInnerHTML={{ __html: inlineScript }} />
      </body>
    </html>
  );
});
