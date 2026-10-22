// 小型原生 WebGL 低多边形渲染器。没有外部 CDN 或构建依赖。
const vs=`attribute vec3 a_pos; attribute vec3 a_nor; attribute vec3 a_col;
uniform mat4 u_model,u_viewproj;uniform vec3 u_tint;varying vec3 v_col;varying float v_fog;
void main(){vec4 w=u_model*vec4(a_pos,1.0);gl_Position=u_viewproj*w;
 vec3 n=normalize(mat3(u_model)*a_nor);
 float diff=max(dot(n,normalize(vec3(-0.5,0.85,0.45))),0.0);
 v_col=a_col*u_tint*(0.68+diff*0.48);
 v_fog=clamp((length(w.xz)-25.0)/85.0,0.0,0.42);
}`;
const fs=`precision mediump float;varying vec3 v_col;varying float v_fog;
void main(){gl_FragColor=vec4(mix(v_col,vec3(0.54,0.69,0.68),v_fog),1.0);}`;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function identity(){return [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];}
function mul(a,b){const o=new Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){o[c*4+r]=0;for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];}return o;}
function model(x,y,z,sx,sy,sz,angle=0){let c=Math.cos(angle),s=Math.sin(angle);return [c*sx,0,-s*sx,0,0,sy,0,0,s*sz,0,c*sz,0,x,y,z,1];}
function perspective(fovy,aspect,near,far){const f=1/Math.tan(fovy/2),nf=1/(near-far);return [f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0];}
function lookAt(eye,center,up){
 let z=[eye[0]-center[0],eye[1]-center[1],eye[2]-center[2]],len=Math.hypot(...z);z=z.map(n=>n/len);
 let x=[up[1]*z[2]-up[2]*z[1],up[2]*z[0]-up[0]*z[2],up[0]*z[1]-up[1]*z[0]];len=Math.hypot(...x);x=x.map(n=>n/len);
 let y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
 return [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-(x[0]*eye[0]+x[1]*eye[1]+x[2]*eye[2]),-(y[0]*eye[0]+y[1]*eye[1]+y[2]*eye[2]),-(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]),1];
}
function meshBuilder(){const data=[];function tri(a,b,c,color=[1,1,1],normal){
 const ab=b.map((n,i)=>n-a[i]),ac=c.map((n,i)=>n-a[i]);let n=normal||[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
 const mag=Math.hypot(...n)||1;n=n.map(t=>t/mag);
 for(const p of [a,b,c])data.push(...p,...n,...color);
}function quad(a,b,c,d,color,normal){tri(a,b,c,color,normal);tri(a,c,d,color,normal);}return{data,tri,quad};}
function cube(){let m=meshBuilder();const a=-.5,b=.5;
 m.quad([a,a,b],[b,a,b],[b,b,b],[a,b,b],[1,1,1],[0,0,1]);
 m.quad([b,a,a],[a,a,a],[a,b,a],[b,b,a],[.83,.9,1],[0,0,-1]);
 m.quad([b,a,b],[b,a,a],[b,b,a],[b,b,b],[.88,.93,1],[1,0,0]);
 m.quad([a,a,a],[a,a,b],[a,b,b],[a,b,a],[.9,.96,1],[-1,0,0]);
 m.quad([a,b,b],[b,b,b],[b,b,a],[a,b,a],[1,1,1],[0,1,0]);
 m.quad([a,a,a],[b,a,a],[b,a,b],[a,a,b],[.77,.82,1],[0,-1,0]);return m.data;}
function tapered(sides=6,bot=.5,top=0){const m=meshBuilder();for(let i=0;i<sides;i++){
 const a=i/sides*Math.PI*2,b=(i+1)/sides*Math.PI*2;
 const p=[Math.cos(a)*bot,0,Math.sin(a)*bot],q=[Math.cos(b)*bot,0,Math.sin(b)*bot];
 const p2=[Math.cos(a)*top,1,Math.sin(a)*top],q2=[Math.cos(b)*top,1,Math.sin(b)*top];
 const col=i%2?[.82,.91,.86]:[1,1,1];
 if(top===0)m.tri(p,q,[0,1,0],col);else m.quad(p,q,q2,p2,col);
 m.tri([0,0,0],q,p,[.75,.82,.75],[0,-1,0]);
 }return m.data;}
function diamond(){const m=meshBuilder(),c=[0,0,0];const points=[[0,.8,0],[0,-.65,0],[-.7,0,0],[.7,0,0],[0,0,-.65],[0,0,.65]];
 for(let i=0;i<4;i++){const ring=[2,4,3,5,2];m.tri(points[0],points[ring[i]],points[ring[i+1]],[1,1,1]);m.tri(points[1],points[ring[i+1]],points[ring[i]],[.72,.83,.9]);}return m.data;}
function terrain(){const m=meshBuilder();let k=54321;const rand=()=>{k=(Math.imul(k,1664525)+1013904223)>>>0;return k/4294967296;};
 for(let x=-48;x<48;x+=4)for(let z=-48;z<48;z+=4){const shade=rand()-.5,c=[.72+shade*.1,.90+shade*.09,.71+shade*.13];
 m.quad([x,-.13,z],[x,-.13,z+4],[x+4,-.13,z+4],[x+4,-.13,z],c,[0,1,0]);}return m.data;}
export class WorldRenderer{
 constructor(canvas){this.canvas=canvas;this.gl=canvas.getContext('webgl',{antialias:true,alpha:false,powerPreference:'high-performance'});
 if(!this.gl)throw Error('浏览器不支持 WebGL');const gl=this.gl;
 const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
 const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 this.program=program;this.loc={p:gl.getAttribLocation(program,'a_pos'),n:gl.getAttribLocation(program,'a_nor'),c:gl.getAttribLocation(program,'a_col'),m:gl.getUniformLocation(program,'u_model'),v:gl.getUniformLocation(program,'u_viewproj'),t:gl.getUniformLocation(program,'u_tint')};
 this.meshes={};for(const [name,data] of Object.entries({cube:cube(),cone:tapered(6),trunk:tapered(7,.5,.42),stone:diamond(),terrain:terrain()})){
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
 this.meshes[name]={buffer,count:data.length/9};}
 gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.clearColor(.52,.68,.72,1);
 this.track=new Map();this.follow={x:0,z:0};this.clock=0;this.viewproj=identity();
 }
 draw(mesh,x,y,z,sx,sy,sz,col,rot=0){const gl=this.gl,g=this.meshes[mesh];if(!g)return;
 gl.bindBuffer(gl.ARRAY_BUFFER,g.buffer);
 for(const [loc,index] of [[this.loc.p,0],[this.loc.n,3],[this.loc.c,6]]){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,36,index*4);}
 gl.uniformMatrix4fv(this.loc.m,false,new Float32Array(model(x,y,z,sx,sy,sz,rot)));
 gl.uniform3fv(this.loc.t,col);gl.drawArrays(gl.TRIANGLES,0,g.count);
 }
 render(state,selfId,buildKind){
 const gl=this.gl,w=this.canvas.clientWidth,h=this.canvas.clientHeight;if(!w||!h)return;
 const dpr=Math.min(window.devicePixelRatio||1,1.55),rw=Math.floor(w*dpr),rh=Math.floor(h*dpr);
 if(this.canvas.width!==rw||this.canvas.height!==rh){this.canvas.width=rw;this.canvas.height=rh;}gl.viewport(0,0,rw,rh);
 this.clock+=1/60;const self=state?.players?.find(p=>p.id===selfId);
 const goalX=self?.x||0,goalZ=self?.z||0;
 this.follow.x+=(goalX-this.follow.x)*.075;this.follow.z+=(goalZ-this.follow.z)*.075;
 const landscape=w>h;
 const camDist=landscape?29:36;
 const eye=[this.follow.x+camDist*.70,camDist*.87,this.follow.z+camDist*1.03];
 const center=[this.follow.x,0,this.follow.z];
 this.viewproj=mul(perspective((landscape?48:54)*Math.PI/180,w/h,.1,180),lookAt(eye,center,[0,1,0]));
 gl.uniformMatrix4fv(this.loc.v,false,new Float32Array(this.viewproj));
 const night=state?.phase==='night'; gl.clearColor(night?.085:.52,night?.16:.68,night?.27:.72,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
 this.draw('terrain',0,0,0,1,1,1,night?[.42,.58,.69]:[.53,.68,.55]);
 // 营地核心基座和四根标识石柱。
 this.draw('cube',0,.13,0,4,.3,4,[.47,.5,.5]);
 this.draw('stone',0,1.45,0,1.25,2.05,1.25,night?[.42,.93,1]:[.43,.86,.96]);
 this.draw('stone',0,2.7,0,.6,.85,.6,[.89,1,1]);
 for(const [x,z] of [[-5,-5],[5,-5],[-5,5],[5,5]]){
 this.draw('stone',x,.45,z,.6,1,.6,[.66,.74,.73]);
 }
 const resources=state?.resources||this.previewResources();
 for(const r of resources){if(r.hp<=0)continue;
 const wob=r.style||0,rx=r.x,rz=r.z;
 if(Math.abs(rx-this.follow.x)>66||Math.abs(rz-this.follow.z)>66)continue;
 if(r.kind==='tree'){
   const s=.92+wob*.1;this.draw('trunk',rx,.8,rz,.47,1.8,.47,[.49,.34,.25]);
   this.draw('cone',rx,1.05,rz,2.8*s,2.4*s,2.8*s,[.17,.45+wob*.025,.38]);
   this.draw('cone',rx,2.05,rz,2.25*s,2.2*s,2.25*s,[.25,.57+wob*.022,.44]);
   this.draw('cone',rx,3.08,rz,1.65*s,1.7*s,1.65*s,[.31,.66+wob*.015,.49]);
 }else if(r.kind==='rock'){
   this.draw('stone',rx,.52,rz,1.85+wob*.14,1.1,1.75,[.57,.66,.67]);
   this.draw('stone',rx+.8,.25,rz+.45,.8,.55,.9,[.63,.71,.71]);
 }else{
   this.draw('cone',rx,.1,rz,1.7,1.1,1.7,[.25,.53,.32]);
   this.draw('stone',rx+.2,.8,rz,.4,.45,.4,[.96,.28,.29]);
   this.draw('stone',rx-.35,.66,rz-.1,.32,.33,.32,[.98,.34,.3]);
 }
 }
 for(const b of state?.buildings||[]){
 if(b.kind==='wall'){
 this.draw('cube',b.x,.9,b.z,1.9,1.7,.65,[.49,.32,.19]);
 for(const dx of [-.69,0,.69])this.draw('cube',b.x+dx,.93,b.z+.04,.06,1.58,.72,[.75,.55,.32]);
 this.draw('cube',b.x,1.5,b.z,2.1,.15,.78,[.42,.28,.19]);
 }else{
 this.draw('stone',b.x,.19,b.z,1.65,.5,1.65,[.54,.55,.52]);
 this.draw('cone',b.x,.42,b.z,.92,1.45,.92,[1,.42,.13]);
 this.draw('cone',b.x+.04,.6,b.z,.45,.95,.45,[1,.80,.22]);
 }
 }
 const ids=new Set();for(const p of state?.players||[]){ids.add(p.id);
 let smooth=this.track.get(p.id);if(!smooth){smooth={x:p.x,z:p.z};this.track.set(p.id,smooth);}
 const damping=(p.id===selfId) ? .40 : .22;smooth.x+=(p.x-smooth.x)*damping;smooth.z+=(p.z-smooth.z)*damping;
 const idx=state.players.indexOf(p);const palette=[[.29,.78,.87],[.88,.60,.39],[.67,.53,.89],[.91,.74,.39]];
 const tint=palette[idx%palette.length];const xx=smooth.x,zz=smooth.z;
 if(p.hp<=0){this.draw('cube',xx,.18,zz,1.15,.27,.66,[.50,.55,.61],p.face);continue;}
 const moving=Math.hypot(p.x-smooth.x,p.z-smooth.z)>.05;
 const step=moving?Math.sin(this.clock*12)*.12:0;
 this.draw('cube',xx,.9,zz,.82,1.1,.62,tint,p.face);
 this.draw('cube',xx,1.72,zz,.57,.56,.57,[.99,.82,.65],p.face);
 this.draw('cube',xx,2.06,zz,.68,.17,.68,[.20,.32,.37],p.face);
 this.draw('cube',xx-.24,.27+step,zz,.24,.58,.27,[.30,.36,.41],p.face);
 this.draw('cube',xx+.24,.27-step,zz,.24,.58,.27,[.30,.36,.41],p.face);
 this.draw('cube',xx-.57,1.03,zz,.30,.76,.29,[.99,.80,.65],p.face);
 this.draw('cube',xx+.57,1.03,zz,.30,.76,.29,[.99,.80,.65],p.face);
 if(p.attack>0){this.draw('cube',xx+.9,1,zz+.4,1.5,.12,.15,[.98,.89,.49],p.face);}
 if(p.id===selfId)this.draw('cube',xx,.055,zz,1.65,.05,1.65,[.38,.89,.97]);
 }
 for(const id of this.track.keys())if(!ids.has(id))this.track.delete(id);
 for(const mob of state?.mobs||[]){const hit=mob.hit>0;
 this.draw('cube',mob.x,.8,mob.z,1.05,1.25,1.0,hit?[1,.65,.7]:[.54,.34,.59],mob.face);
 this.draw('cube',mob.x,1.65,mob.z,1.13,.66,1.12,hit?[1,.81,.83]:[.65,.43,.71],mob.face);
 this.draw('cube',mob.x-.31,1.68,mob.z+.58,.16,.17,.12,[.98,.21,.32]);
 this.draw('cube',mob.x+.31,1.68,mob.z+.58,.16,.17,.12,[.98,.21,.32]);
 this.draw('cube',mob.x-.40,.22,mob.z,.29,.46,.35,[.35,.28,.39]);
 this.draw('cube',mob.x+.40,.22,mob.z,.29,.46,.35,[.35,.28,.39]);
 }
 if(self&&buildKind){let face=self.face||0;let x=Math.round((self.x+Math.sin(face)*4.2)/2)*2,z=Math.round((self.z+Math.cos(face)*4.2)/2)*2;
 this.draw('cube',x,.10,z,2,.18,2,[.8,.96,.44]);
 if(buildKind==='wall')this.draw('cube',x,.82,z,1.85,1.5,.63,[.72,.88,.49]);
 else this.draw('cone',x,.15,z,1.4,1.5,1.4,[1,.72,.31]);
 }
 }
 previewResources(){if(this._demo)return this._demo;const r=[];let n=0;for(let i=0;i<90;i++){const angle=i*2.399963,dist=14+Math.sqrt(i)*3.3;let x=Math.cos(angle)*dist,z=Math.sin(angle)*dist;if(Math.abs(x)>45||Math.abs(z)>45)continue;r.push({id:'demo'+n++,x,z,kind:i%6===0?'rock':i%7===0?'berry':'tree',hp:2,style:i%4});}this._demo=r;return r;}
}
