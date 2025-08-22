// Generate stars dynamically and place them in .star-container
(function(){
  const STAR_COUNT = 300;
  const container = document.createElement('div');
  container.className = 'star-container';
  document.body.appendChild(container);
  const w = window.innerWidth;
  const h = window.innerHeight;
  for(let i=0;i<STAR_COUNT;i++){
    const s = document.createElement('div');
    s.className = 'star';
    s.style.left = (Math.random()* (w*1.5) - w*0.25) + 'px';
    s.style.top = (Math.random()* (h*1.2) - h*0.1) + 'px';
    s.style.width = (Math.random()*2 + 1) + 'px';
    s.style.height = s.style.width;
    s.style.animation = `twinkle ${2+Math.random()*6}s linear ${Math.random()*5}s infinite`;
    container.appendChild(s);
  }
})();

// Insert solar system markup into body
(function(){
  const html = `
  <div class="container solar">
    <div class="sun"></div>
    <div class="mercurys-orbit"><div class="mercury"></div></div>
    <div class="venus-orbit"><div class="venus"></div></div>
    <div class="earths-orbit"><div class="earth"></div></div>
    <div class="mars-orbit"><div class="mars"></div></div>
    <div class="jupiters-orbit"><div class="jupiter"></div></div>
    <div class="saturns-orbit"><div class="saturn"><div class="ring"></div></div></div>
    <div class="uranus-orbit"><div class="uranus"></div></div>
    <div class="neptunes-orbit"><div class="neptune"></div></div>
    <div class="plutos-orbit"><div class="pluto"></div></div>
  </div>`;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper.firstElementChild);
})();

// Make sure the stars reposition on resize
window.addEventListener('resize', ()=>{
  const stars = document.querySelectorAll('.star');
  const w = window.innerWidth;
  const h = window.innerHeight;
  stars.forEach(s => {
    s.style.left = (Math.random()* (w*1.5) - w*0.25) + 'px';
    s.style.top = (Math.random()* (h*1.2) - h*0.1) + 'px';
  });
});
