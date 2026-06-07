import { embedText } from './server/src/lib/embedding.js';

// テスト1: API キー未設定時
const test1 = async () => {
  console.log('Test 1: API key undefined');
  const result = await embedText('test');
  console.log('Result:', result);
};

test1().catch(console.error);
