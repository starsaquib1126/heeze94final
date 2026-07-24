/* HEEZE 94 · chat.js · Gemini AI Fragrance Advisor */
(function(){
  const SYSTEM=`You are the fragrance advisor for HEEZE 94, a premium attar house whose oils are crafted in Dubai. You speak with quiet, elegant authority — like a knowledgeable consultant in a luxury perfume boutique.

Our attar collection (pure concentrated oils, 3ml / 6ml / 12ml):
- Black Oud: Smoked agarwood, dark resin, leather accord, deep woods, warm musk. Intense, ceremonial. ₹499–₹1499.
- Golden Oud: Saffron, golden honey, radiant oud, amber, soft woods. Warm, luminous, regal. ₹499–₹1499.
- Rose Musk: Fresh rose petals, velvet damask rose, soft white musk. Tender, romantic, skin-close. ₹399–₹1299.

Parfums (Al-Durrah, Arabian Knight's and more) are coming soon — direct them to the Parfums page.

Help customers find their perfect attar. Ask about their preferences, lifestyle, occasions. Keep responses to 2-4 sentences of refined prose (no bullet points). Always end with a question or gentle invitation.`;

  const widget=document.createElement('div');
  widget.innerHTML=`
<button class="ai-fab" id="aiFab" aria-label="Open fragrance advisor" onclick="window._h94chat.toggle()">
  <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
</button>
<div class="ai-panel" id="aiPanel" role="dialog" aria-label="HEEZE 94 Fragrance Advisor">
  <div class="ai-head">
    <div class="ai-head-info">
      <div class="ai-avatar">H</div>
      <div class="ai-head-text">
        <strong>Fragrance Advisor</strong>
        <span>HEEZE 94 · Powered by Gemini</span>
      </div>
    </div>
    <button class="ai-close-btn" onclick="window._h94chat.toggle()" aria-label="Close">×</button>
  </div>
  <div class="ai-msgs" id="aiMsgs"></div>
  <div class="ai-input-row">
    <input class="ai-input" id="aiInput" placeholder="Ask about our fragrances…" autocomplete="off"
      onkeydown="if(event.key==='Enter')window._h94chat.send()"/>
    <button class="ai-send-btn" onclick="window._h94chat.send()">Send</button>
  </div>
</div>`;
  document.body.appendChild(widget);

  let open=false, history=[];
  const API_KEY='AIzaSyCT_aCpnWLq7Xu67QC4m7H3VTSSrI_HNQ4'; // Replace with your Gemini API key from aistudio.google.com

  function toggle(){
    open=!open;
    document.getElementById('aiPanel').classList.toggle('open',open);
    if(open&&history.length===0) greet();
    if(open) setTimeout(()=>document.getElementById('aiInput').focus(),350);
  }
  function greet(){
    addMsg('bot','Welcome to HEEZE 94. I\'m your personal fragrance advisor — are you discovering attar for the first time, or do you have a favourite style of fragrance in mind?');
  }
  function addMsg(role,text){
    const msgs=document.getElementById('aiMsgs');
    const d=document.createElement('div');
    d.className='ai-msg '+role; d.textContent=text;
    msgs.appendChild(d); msgs.scrollTop=msgs.scrollHeight;
  }
  function addTyping(){
    const msgs=document.getElementById('aiMsgs');
    const d=document.createElement('div');
    d.className='ai-msg bot typing'; d.id='aiTyping'; d.textContent='…';
    msgs.appendChild(d); msgs.scrollTop=msgs.scrollHeight;
    return d;
  }
  async function send(){
    const inp=document.getElementById('aiInput');
    const text=inp.value.trim(); if(!text)return;
    inp.value=''; addMsg('user',text);
    history.push({role:'user',parts:[{text}]});
    const typing=addTyping();
    try{
      const body={
        system_instruction:{parts:[{text:SYSTEM}]},
        contents:history,
        generationConfig:{maxOutputTokens:200,temperature:.78}
      };
      const res=await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
        {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}
      );
      if(!res.ok)throw new Error(res.status);
      const data=await res.json();
      const reply=data.candidates?.[0]?.content?.parts?.[0]?.text||fallback(text);
      typing.remove(); addMsg('bot',reply);
      history.push({role:'model',parts:[{text:reply}]});
    }catch(e){
      typing.remove(); const r=fallback(text); addMsg('bot',r);
      history.push({role:'model',parts:[{text:r}]});
    }
  }
  function fallback(q){
    q=q.toLowerCase();
    if(q.includes('oud')||q.includes('dark')||q.includes('wood'))
      return 'For lovers of depth and intensity, Black Oud is the house signature — smoked agarwood that evolves into a warm leathered warmth. For something more luminous, Golden Oud brings radiance and a touch of saffron. Which direction draws you?';
    if(q.includes('rose')||q.includes('flower')||q.includes('light')||q.includes('soft'))
      return 'Rose Musk was composed for those who prefer a fragrance that stays quietly close — velvet petals in the softest white musk. It is intimate rather than loud, and becomes uniquely yours with wear. Shall I tell you more?';
    if(q.includes('gift'))
      return 'For gifting, Golden Oud is our most warmly received — luminous enough to feel special, approachable enough for most tastes. A beautifully presented 6 ml makes a perfect gesture. May I ask a little about the person?';
    if(q.includes('price')||q.includes('cost')||q.includes('₹'))
      return 'Our attars begin at ₹399 for the 3 ml Rose Musk and ₹499 for the 3 ml oud expressions. Each is a concentrated oil — a single drop lasts for hours. Shall I help you find the right size?';
    return 'I would be glad to guide you. Could you tell me the kinds of scents you are drawn to — something rich and deep, something warm and luminous, or something softer and floral?';
  }

  window._h94chat={toggle,send};
})();
