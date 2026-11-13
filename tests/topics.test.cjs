const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../topics.js');
const T=globalThis.YqnTopics;

test('description chapter lists retain every app, including lists longer than twelve',()=>{
  const description='Useful links\nhttps://example.org\nTimeline\n'+Array.from({length:16},(_,i)=>`${i}:00 App ${i+1}`).join('\n');
  const chapters=T.fromDescription(description,960);
  assert.equal(chapters.length,16);assert.equal(chapters.at(-1).start,900);assert.equal(chapters[0].source,'description');
});
test('incidental, malformed, unordered and out-of-video timestamps are not topic maps',()=>{
  for(const text of ['1:10 Example\n2:00 End','0:99 Invalid\n1:00 Later','0:00 One\n2:00 Two\n1:00 Wrong','0:00 Only'])assert.equal(T.fromDescription(text,600).length,0);
  assert.equal(T.fromDescription('0:00 Start\n0:30 Next\n1:00 End',60).length,2);
  assert.equal(T.fromDescription('0:00 Start\n1:01:02 Later',4000)[1].start,3662);
});
test('only the current player chapter payload supplies native topics',()=>{
  const markers={chapters:[{chapterRenderer:{timeRangeStartMillis:0,title:{simpleText:'App A'}}},
    {chapterRenderer:{timeRangeStartMillis:'61000',title:{runs:[{text:'App '},{text:'B'}]}}},
    {chapterRenderer:{timeRangeStartMillis:61000,title:{simpleText:'Duplicate'}}},
    {chapterRenderer:{timeRangeStartMillis:-10,title:{simpleText:'Bad'}}}]};
  assert.equal(T.fromPlayerData({recommendations:markers},600).length,0);
  assert.deepEqual(T.fromPlayerData({playerOverlays:{nested:markers}},600).map(c=>[c.start,c.title]),[[0,'App A'],[61,'App B']]);
});
test('topic normalisation rejects invalid anchors and keeps titles as plain data',()=>{
  assert.deepEqual(T.clean([{start:NaN,title:'Bad'},{start:null,title:'Bad'},{start:'1',title:'Bad'},
    {start:12,title:'<b>App</b>'},{start:12,title:'Duplicate'},{start:70,title:'Too late'}],60),
    [{start:12,title:'<b>App</b>',source:'ai'}]);
});
