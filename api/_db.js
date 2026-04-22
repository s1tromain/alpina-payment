const { createClient } = require('@supabase/supabase-js');

let supabase;

function getDb() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error('Supabase not configured');
    }
    supabase = createClient(url, key);
  }
  return supabase;
}

module.exports = { getDb };
