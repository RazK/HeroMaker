import os, math, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W,H=720,1280; FPS=30
INK=(0x23,0x19,0x42); CREAM=(0xff,0xf6,0xe9); PUR=(0x5B,0x3F,0xD6)
F=ImageFont.truetype('barriecito.ttf',42)
S='..'; os.makedirs('out',exist_ok=True)
def frames(d): return sorted(os.listdir(d))
def load(d,i):
    fs=frames(d); return Image.open(os.path.join(d,fs[min(i,len(fs)-1)])).convert('RGB')
def cover(im,cx=0.5,cy=0.5,zoom=1.0):
    r=max(W/im.width,H/im.height)*zoom; w,h=int(im.width*r),int(im.height*r); im=im.resize((w,h),Image.LANCZOS)
    x=int(min(max(cx*w-W/2,0),w-W)); y=int(min(max(cy*h-H/2,0),h-H)); return im.crop((x,y,x+W,y+H))
def shiftdown(im,dy):
    c=Image.new('RGB',(W,H)); c.paste(im,(0,dy)); top=im.crop((0,0,W,dy)).transpose(Image.FLIP_TOP_BOTTOM).filter(ImageFilter.GaussianBlur(2)); c.paste(top,(0,0)); return c
def pill(im,text,y=196):
    d=ImageDraw.Draw(im); l,t,r,b=d.textbbox((0,0),text,font=F); pw,ph=r-l+52,b-t+30; x=336-pw//2; assert x>=48 and x+pw<=624,(text,x,x+pw)
    d.rounded_rectangle((x,y+8,x+pw,y+ph+8),radius=ph//2,fill=INK); d.rounded_rectangle((x,y,x+pw,y+ph),radius=ph//2,fill=CREAM,outline=INK,width=3)
    d.text((x+26-l,y+15-t),text,font=F,fill=INK)
def key(im,src,fit_h=False):
    a=np.asarray(im).astype(np.int32); r,g,b=a[...,0],a[...,1],a[...,2]
    m=(g>120)&(g>r*1.35)&(g>b*1.35)
    if m.sum()<50: return im
    cs=m.sum(0); rs=m.sum(1); cx_=np.where(cs>0.35*cs.max())[0]; ry_=np.where(rs>0.35*rs.max())[0]
    x0,x1,y0,y1=cx_.min(),cx_.max(),ry_.min(),ry_.max(); bw,bh=x1-x0+1,y1-y0+1
    box=np.zeros_like(m); box[max(y0-3,0):y1+4,max(x0-3,0):x1+4]=True; m=m&box
    if fit_h:
        r_=bh/src.height; st=src.resize((int(src.width*r_)+1,bh),Image.LANCZOS)
        s=src.resize((bw,bh),Image.LANCZOS).filter(ImageFilter.GaussianBlur(25)); s.paste(st,((bw-st.width)//2,0))
    else:
        r_=max(bw/src.width,bh/src.height); s=src.resize((int(src.width*r_)+1,int(src.height*r_)+1),Image.LANCZOS)
        sx=(s.width-bw)//2; sy=(s.height-bh)//2; s=s.crop((sx,sy,sx+bw,sy+bh))
    M=Image.fromarray((m*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1))
    # despill
    a2=a.copy(); spill=a2[...,1]>np.maximum(a2[...,0],a2[...,2]); a2[...,1]=np.where(spill,np.maximum(a2[...,0],a2[...,2]),a2[...,1])
    out=Image.fromarray(a2.astype(np.uint8)); layer=out.copy(); layer.paste(s,(x0,y0))
    return Image.composite(layer,out,M)
VW=[Image.open(f'{S}/va_w/{f}').convert('RGBA') for f in sorted(os.listdir(f'{S}/va_w'))]
n=0
def save(im,cap=None):
    global n
    if cap: pill(im,cap)
    im.save(f'out/{n:04d}.png'); n+=1
def ease(t): return 1-(1-t)**3
# S1 hook 0-1.5 s: Violet rises off the drawing (no text)
for i in range(45):
    t=i/FPS; bg=cover(load('src/c11',i),0.55).convert('RGBA')
    p=min(t/0.5,1); e=ease(p)
    fr=VW[min(int(max(t-0.5,0)*16),len(VW)-1)]
    hgt=int(100+640*e); v=fr.resize((int(fr.width*hgt/fr.height),hgt),Image.LANCZOS)
    if p<1: v.putalpha(v.getchannel('A').point(lambda a:int(a*min(1,p*2.5))))
    cx,feet=400,int(900-40*e)
    glow=Image.new('RGBA',(W,H),(0,0,0,0)); gd=ImageDraw.Draw(glow); R=int(60+260*e)
    gd.ellipse((cx-R,feet-R*1.3,cx+R,feet+R*0.3),fill=(255,236,170,int(120*(1-0.6*e))))
    bg.alpha_composite(glow.filter(ImageFilter.GaussianBlur(40)))
    sh=Image.new('RGBA',(W,H),(0,0,0,0)); ImageDraw.Draw(sh).ellipse((cx-int(110*e)-10,feet-14,cx+int(110*e)+10,feet+18),fill=(40,20,0,int(110*e))); bg.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)))
    bg.alpha_composite(v,(cx-v.width//2,feet-v.height)); save(bg.convert('RGB'))
# S2 1.5-3.5
for i in range(60): save(cover(load('src/c12',20+i),0.62),'She drew this at breakfast.')
# S3 3.5-5.5: hand + phone, real camera screen
for i in range(60):
    save(key(shiftdown(cover(load('src/k3',i),0.5),110),load('src/cam',i)),'Snap it.')
# S4 5.5-8: closer, the real hero page reveal (real speed)
for i in range(75):
    bg=cover(load('src/k3',max(74-i,0)),0.5,0.70,1.12); scr=load('src/hero',i) if i<45 else load('src/hero2',i-45); save(key(bg,scr),'Every line kept.')
# S5 8-10
for i in range(60): save(cover(load('src/c24',10+i),0.5,0.45),'Her drawing. Her hero.')
# S6 10-12.5
for i in range(75): save(shiftdown(cover(key(load('src/k6',i),load('src/stage',i),True),0.469),100),'Now she plays it.')
# S7 12.5-15 still end card
k7=Image.open(f'{S}/kf2/k7.png').convert('RGB'); low=k7.crop((0,int(k7.height*0.2),k7.width,k7.height)).resize((720,int(720*k7.height*0.8/k7.width)),Image.LANCZOS)
card=Image.new('RGBA',(W,H),CREAM+(255,)); card.paste(low,(0,H-low.height))
wood=low.crop((low.width-260,0,low.width,low.height)).resize((W,low.height)).filter(ImageFilter.GaussianBlur(2)); card.paste(wood,(0,H-low.height))
orig=Image.open(f'{S}/violet/original.jpg').convert('RGB'); pw_,ph_=430,560
paper=Image.new('RGB',(pw_,ph_),(250,249,244)); od=orig.resize((pw_-30,pw_-30),Image.LANCZOS); paper.paste(od,(15,(ph_-od.height)//2))
paper=paper.convert('RGBA').rotate(4,expand=True,resample=Image.BICUBIC)
ps=Image.new('RGBA',(W,H),(0,0,0,0)); ps.paste((30,15,0,110),(30,600,30+paper.width,600+paper.height),paper.getchannel('A')); card.alpha_composite(ps.filter(ImageFilter.GaussianBlur(14)))
card.alpha_composite(paper,(18,580))
vi=Image.open(f'{S}/v_alpha/0040.png').convert('RGBA'); hv=470; vi=vi.resize((int(vi.width*hv/vi.height),hv),Image.LANCZOS)
sh=Image.new('RGBA',(W,H),(0,0,0,0)); ImageDraw.Draw(sh).ellipse((400,1000,640,1040),fill=(40,20,0,120)); card.alpha_composite(sh.filter(ImageFilter.GaussianBlur(12)))
card.alpha_composite(vi,(520-vi.width//2,1020-hv))
fade=Image.new('RGBA',(W,H),(0,0,0,0)); fd=ImageDraw.Draw(fade)
for y in range(H):
    a=255 if y<440 else max(0,int(255*(1-(y-440)/90)))
    if a: fd.line((0,y,W,y),fill=CREAM+(a,))
card.alpha_composite(fade); d=ImageDraw.Draw(card)
WM=ImageFont.truetype('barriecito.ttf',58); l,tp,r,b=d.textbbox((0,0),'HeroMaker',font=WM); ww=r-l; lw=72+14+ww; lx=336-lw//2
ic=Image.open(f'{S}/c5/assets/app-icon.png').convert('RGBA').resize((72,72)); card.alpha_composite(ic,(lx,62)); d.text((lx+86-l,98-(b-tp)//2-tp),'HeroMaker',font=WM,fill=INK)
T=ImageFont.truetype('barriecito.ttf',62)
def ct(t,y,f,fill=INK):
    l,tp,r,b=d.textbbox((0,0),t,font=f); d.text((336-(r-l)//2-l,y-tp),t,font=f,fill=fill)
ct("Your child's drawing,",180,T); ct("brought to life.",252,T)
bw,bh=340,84; bx=336-bw//2; by=348
d.rounded_rectangle((bx,by+6,bx+bw,by+bh+6),radius=bh//2,fill=INK); d.rounded_rectangle((bx,by,bx+bw,by+bh),radius=bh//2,fill=PUR)
B=ImageFont.truetype('barriecito.ttf',46); l,tp,r,b=d.textbbox((0,0),'Make a hero',font=B); d.text((bx+(bw-(r-l))//2-l,by+(bh-(b-tp))//2-tp),'Make a hero',font=B,fill=(255,255,255))
card=card.convert('RGB')
for i in range(75): save(card)
print('frames',n)
