"""Plan 39 F (2026-10-23): paint shoe logos out of pitcher sheets (art/sprites/pitcher).
Usage from repo root: python3 tools/clean-pitcher-shoes.py art/sprites/pitcher/1990-darkbrown.png out.png '<boxes json>' 75 95
Boxes used (hand-checked shoe areas, x0,y0,x1,y1 on the 2880x480 sprite):
{"1990-darkbrown": [[837, 262, 939, 367], [1149, 290, 1270, 396], [2263, 347, 2343, 422], [1909, 364, 2025, 480], [1542, 368, 1644, 480], [2653, 393, 2754, 480], [2276, 394, 2374, 480], [467, 401, 626, 480], [88, 403, 184, 480], [840, 403, 947, 480], [1204, 408, 1331, 480], [179, 415, 273, 480]], "1970-darkbrown": [[793, 278, 912, 378], [1160, 294, 1265, 391], [2566, 294, 2651, 382], [1914, 356, 2026, 480], [1559, 358, 1674, 480], [2258, 358, 2378, 480], [2653, 398, 2742, 480], [93, 405, 185, 480], [175, 405, 271, 480], [455, 405, 548, 480], [536, 405, 625, 480], [837, 406, 956, 480], [1201, 411, 1326, 480]]}
Note: art/source/pitcher PNGs still show the logos; re-slicing from source would bring them back.
Original note: paint shoe logos out of pitcher sheets. Marks are colored/bright pixels or see-through holes
mostly surrounded by black shoe pixels. Only inside the hand-checked shoe boxes given per sheet."""
import sys, json, numpy as np
from PIL import Image
from scipy import ndimage
SHOE=(28,28,30,255)
def candidates(a, frac=0.5, win=11, dk=75, LT=150):
    rgb=a[...,:3].astype(int); al=a[...,3]
    mx=rgb.max(-1); mn=rgb.min(-1)
    opaque=al>200
    dark=(mx<dk)&opaque
    df=ndimage.uniform_filter(dark.astype(float),win)
    mark=opaque&~dark&((mx-mn>40)|(mx>LT))&(df>=frac)
    holes=ndimage.binary_fill_holes(opaque)&~opaque
    lab,n=ndimage.label(holes)
    if n:
        sizes=ndimage.sum(holes,lab,range(1,n+1))
        holes=np.isin(lab,[i+1 for i,s in enumerate(sizes) if s<=600])&(df>=0.35)
    hit=mark|holes
    lab,n=ndimage.label(hit)
    if n:
        sizes=ndimage.sum(hit,lab,range(1,n+1))
        hit=np.isin(lab,[i+1 for i,s in enumerate(sizes) if s<=600])
    return hit
def clean(a, boxes, dk=75, LT=150, rounds=3):
    a=a.copy(); allp=np.zeros(a.shape[:2],bool)
    for x0,y0,x1,y1 in boxes:
        sub=a[y0:y1,x0:x1]; mx=sub[...,:3].max(-1)
        dpx=sub[(mx<dk)&(sub[...,3]>200)]
        color=np.append(np.median(dpx[:,:3],0).astype(np.uint8),255) if len(dpx) else np.array(SHOE,np.uint8)
        done=np.zeros(sub.shape[:2],bool)
        for _ in range(rounds):
            p=candidates(sub,dk=dk,LT=LT)&~done
            if not p.any(): break
            sub[p]=color; done|=p
        allp[y0:y1,x0:x1]|=done
    return a,allp
if __name__=='__main__':
    src,dst,boxes=sys.argv[1],sys.argv[2],json.loads(sys.argv[3]); dk=int(sys.argv[4]) if len(sys.argv)>4 else 75; LT=int(sys.argv[5]) if len(sys.argv)>5 else 150
    a=np.array(Image.open(src).convert('RGBA'))
    b,p=clean(a,boxes or [(0,0,a.shape[1],a.shape[0])],dk,LT); print(src,'painted',int(p.sum()))
    Image.fromarray(b).save(dst); np.save(dst+'.mask.npy',p)
