import test from 'node:test';
import assert from 'node:assert/strict';
import { literalMatches } from '../web/search.js';
test('find treats punctuation literally and preserves Unicode offsets',()=>{
 assert.deepEqual(literalMatches('a+b A+B a?b','a+b'),[{start:0,end:3},{start:4,end:7}]);
 assert.deepEqual(literalMatches('😀中文 😀中文','中文'),[{start:2,end:4},{start:7,end:9}]);
 assert.equal(literalMatches('Text','').length,0);assert.equal(literalMatches('a.b','[').length,0);
});
