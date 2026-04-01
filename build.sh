#!/bin/sh
cat > lib/config.js << EOF
export const SUPABASE_URL = '${SUPABASE_URL}';
export const SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY}';
EOF
