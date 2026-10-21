"""Research vectorized CPU neighborhood attention; verify against installed NATTEN."""
import torch
from functools import lru_cache
@lru_cache(maxsize=64)
def neighbors(length,k,d):
 i=torch.arange(length);start=torch.maximum(i-(k//2)*d,i%d);last=length-1-(length-1-i)%d;start=torch.minimum(start,last-(k-1)*d);idx=start[:,None]+torch.arange(k)[None,:]*d;bias=k-1+(idx-i[:,None])//d
 return idx,bias
@lru_cache(maxsize=32)
def neighbors2(h,w,k,d):
 iy,by=neighbors(h,k,d);ix,bx=neighbors(w,k,d);idx=(iy[:,None,:,None]*w+ix[None,:,None,:]).reshape(h*w,k*k);bias=(by[:,None,:,None]*(2*k-1)+bx[None,:,None,:]).reshape(h*w,k*k)
 return idx,bias

def qk(q,key,rpb,k,d):
 shape=q.shape;two=q.ndim==5
 idx,bias=neighbors2(shape[2],shape[3],k,d) if two else neighbors(shape[2],k,d);idx=idx.to(q.device);bias=bias.to(q.device);q=q.flatten(2,-2);key=key.flatten(2,-2);parts=[]
 for start in range(0,q.shape[2],2048):
  ids=idx[start:start+2048];v=(q[:,:,start:start+2048,None,:]*key[:,:,ids,:]).sum(-1)
  if rpb is not None:v=v+rpb.flatten(1)[:,bias[start:start+2048]][None]
  parts.append(v)
 result=torch.cat(parts,dim=2)
 return result.reshape(*shape[:-1],k*k if two else k)
def av(att,value,k,d):
 shape=value.shape;two=value.ndim==5;idx,_=neighbors2(shape[2],shape[3],k,d) if two else neighbors(shape[2],k,d);idx=idx.to(value.device);att=att.flatten(2,-2);value=value.flatten(2,-2);parts=[]
 for start in range(0,value.shape[2],2048):parts.append((att[:,:,start:start+2048,:,None]*value[:,:,idx[start:start+2048],:]).sum(-2))
 return torch.cat(parts,dim=2).reshape(shape)
def patch(model):
 for module in model.modules():
  if hasattr(module,'nattendqkrpb'):module.nattendqkrpb=qk;module.nattendav=av
 return model
