const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');

function setup(width,height) {
  const actions=[], deleted=[];
  const image={width,height,saveAsync:async options=>{actions.push(['save',options]);return {uri:'file:///cache/optimized.jpg'};}};
  const context={renderAsync:async()=>image,resize:size=>{actions.push(['resize',size]);return context;},release:()=>actions.push('release')};
  class File { constructor(uri){this.uri=uri;} get exists(){return true;} delete(){deleted.push(this.uri);} }
  const load=mobileModules({'expo-file-system':{File},'expo-image-manipulator':{ImageManipulator:{manipulate:uri=>{actions.push(['open',uri]);return context;}},SaveFormat:{JPEG:'jpeg'}}});
  return {prepare:load('src/services/imageUpload.ts').prepareImageUpload,actions,deleted};
}

test('mobile uploads resize the long edge and encode JPEG before sending',async()=>{
  for(const [width,height,expected] of [[4032,3024,{width:1024}],[3024,4032,{height:1024}]]) {
    const c=setup(width,height), result=await c.prepare('file:///original.png');
    assert.deepEqual(c.actions.find(a=>Array.isArray(a)&&a[0]==='resize'),['resize',expected]);
    assert.deepEqual(c.actions.find(a=>Array.isArray(a)&&a[0]==='save'),['save',{format:'jpeg',compress:.78}]);
    assert.equal(result.uri,'file:///cache/optimized.jpg'); result.dispose();
    assert.deepEqual(c.deleted,['file:///cache/optimized.jpg']);
  }
});
test('small uploads are compressed without enlarging the original',async()=>{
  const c=setup(100,80);await c.prepare('file:///original.jpg',800);
  assert.equal(c.actions.some(a=>Array.isArray(a)&&a[0]==='resize'),false);
});
