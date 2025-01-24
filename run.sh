#!/bin/bash

# Tampilkan menu pilihan
echo "Pilih Server Provider:"
echo "1. TSEL"
echo "2. ISAT"
echo "3. XL"
read -p "Pilih>> " pilihan

# Tentukan nilai server berdasarkan pilihan pengguna
case "$pilihan" in
  1) server="tsel" ;;
  2) server="isat" ;;
  3) server="xl" ;;
  *) 
    echo "Pilihan tidak valid."
    exit 1
    ;;
esac

# Update atau buat file server.json dengan nilai server yang dipilih
cat > server.json <<EOF
[
  {
    "server": "$server"
  }
]
EOF

echo "server.json telah diperbarui dengan server: $server"

# Install dependensi Node.js
echo "Menginstal paket Node.js..."
npm install

# Jalankan skrip Node.js
echo "Menjalankan provider.js..."
node prov.js
