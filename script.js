'use strict';
const content = {
team:{label:'PROJECT / WEB',title:'HNUST 第五人格校队',intro:'把校队的热爱放进一个有氛围的网站，是我正在推进的想法。',items:['展示校队介绍、成员与第五人格元素。','规划邀请码注册、独立账号和成员个人主页。','规划管理员权限，队员资料仅向有权限的用户开放。'],foot:'这里记录项目方向；当前个人网站不收集队员信息。'},
focus:{label:'PROJECT / ANDROID',title:'Elaina Focus',intro:'想把学习时间变成一段安静的陪伴：银发魔女、自己的小房间，以及刚刚好的专注节奏。',items:['本地番茄钟与休息计时。','探索更有氛围的学习房间视觉。','关注低功耗、本地使用与简洁操作。'],foot:'项目持续探索中，本站暂不提供应用下载。'},
reader:{label:'PROJECT / ANDROID',title:'本地阅读器',intro:'阅读本身就足够有趣，我希望工具能让人更自然地沉浸在故事里。',items:['探索本地书籍管理与阅读体验。','关注字体、行距、主题等排版细节。','尝试让界面更清爽，让阅读更舒适。'],foot:'项目持续探索中，本站暂不提供应用下载。'},
memo:{label:'PROJECT / LEARNING TOOL',title:'单词学习助手',intro:'把每天的学习整理成看得懂的记录，让复习更有方向。',items:['关注完成词数、新词与复习词的汇总。','整理熟悉、模糊与忘记的学习状态。','探索每日复盘与下一步复习重点。'],foot:'本站展示项目想法，不访问或展示个人单词账户数据。'},
math:{label:'LEARNING / MATHEMATICS',title:'数学二 · 我的复习路线',intro:'先理解概念与方法，再把它用到具体题目里。',items:['高等数学：极限、泰勒展开、导数、积分与微分方程。','线性代数：秩、线性表示、特征值、相似对角化与二次型。','复盘习惯：说清解题思路，整理条件与易错点。'],foot:'这些是我的学习方向，后续会继续整理自己的学习手记。'},
circuit:{label:'LEARNING / CIRCUITS',title:'电路 · 从公式到理解',intro:'希望不只会算，也能理解电流、电压与电路结构之间的关系。',items:['基础方法：KCL、KVL、戴维南与诺顿等效。','正弦稳态：相量、阻抗、复功率与谐振。','继续探索：网络函数、滤波器、暂态响应与电机基础。'],foot:'一步一步画清电路，再一步一步理清关系。'},
tech:{label:'LEARNING / TECHNOLOGY',title:'代码与嵌入式 · 持续探索',intro:'从一个小网站、一个本地应用开始，把好奇变成动手实践。',items:['网站：界面设计、交互体验与静态部署。','应用：本地阅读、专注计时与低功耗体验。','软硬件：继续认识嵌入式与电气基础的联系。'],foot:'这里记录正在探索的方向，不将学习计划当作已经掌握的能力。'}
};
const menu = document.querySelector('.menu-button');
const nav = document.querySelector('.nav-links');
menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'关闭导航':'打开导航');nav.classList.toggle('open',open);});
nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('open');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','打开导航');}));
document.addEventListener('keydown',e=>{if(e.key==='Escape'){nav.classList.remove('open');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','打开导航');}});
const dialog=document.querySelector('#detail-dialog');
function openDetail(key){const data=content[key];if(!data)return;document.querySelector('#dialog-label').textContent=data.label;document.querySelector('#dialog-title').textContent=data.title;document.querySelector('#dialog-intro').textContent=data.intro;document.querySelector('#dialog-foot').textContent=data.foot;const list=document.querySelector('#dialog-list');list.replaceChildren(...data.items.map(item=>{const li=document.createElement('li');li.textContent=item;return li;}));dialog.showModal();}
document.querySelectorAll('[data-project],[data-note]').forEach(b=>b.addEventListener('click',()=>openDetail(b.dataset.project||b.dataset.note)));
document.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
const filters=document.querySelectorAll('.filter');
filters.forEach(button=>button.addEventListener('click',()=>{filters.forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});let count=0;document.querySelectorAll('.project-card').forEach(card=>{const visible=button.dataset.filter==='all'||card.dataset.category===button.dataset.filter;card.hidden=!visible;if(visible)count++;});document.querySelector('.filter-status').textContent='已显示 '+count+' 个项目';}));
document.querySelector('#year').textContent=new Date().getFullYear();
