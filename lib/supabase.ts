// Supabase 클라이언트
// - 브라우저와 서버 어디서든 import해서 쓸 수 있는 단일 진입점
// - .env.local의 두 환경변수를 읽어 클라이언트를 만든다
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '환경변수 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 비어있습니다. .env.local 을 확인하세요.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);