#!/usr/bin/env bash

set -xeuo pipefail

function prepare() {
  local cwd=$1
  local fwd=$(readlink -f "$cwd")
  mkdir -p "$cwd"/{certs,crl,newcerts,private}
  echo 1000 > "$cwd/serial"
  touch "$cwd"/{index.txt,index.txt.attr}

  echo '
     [ ca ]
     default_ca = CA_default
     [ CA_default ]
     dir            = '"$fwd"'
     certs          = $dir/certs               # Where the issued certs are kept
     crl_dir        = $dir/crl                 # Where the issued crl are kept
     database       = $dir/index.txt           # database index file.
     new_certs_dir  = $dir/newcerts            # default place for new certs.
     certificate    = $dir/cacert.pem          # The CA certificate
     serial         = $dir/serial              # The current serial number
     crl            = $dir/crl.pem             # The current CRL
     private_key    = $dir/private/ca.key.pem  # The private key
     RANDFILE       = $dir/.rnd                # private random number file
     nameopt        = default_ca
     certopt        = default_ca
     policy         = policy_match
     default_days   = 36500
     default_md     = sha256

     [ policy_match ]
     countryName            = optional
     stateOrProvinceName    = optional
     organizationName       = optional
     organizationalUnitName = optional
     commonName             = supplied
     emailAddress           = optional

     [req]
     req_extensions = v3_req
     distinguished_name = req_distinguished_name

     [req_distinguished_name]

     [v3_req]' > "$cwd/openssl.cnf"

  if [[ $cwd == out ]] ; then
    echo "keyUsage = digitalSignature, keyEncipherment" >> "$cwd/openssl.cnf"
    echo "extendedKeyUsage = serverAuth, clientAuth" >> "$cwd/openssl.cnf"
    echo "subjectAltName = DNS:localhost" >> "$cwd/openssl.cnf"
  else
    echo "basicConstraints = CA:TRUE" >> "$cwd/openssl.cnf"
  fi
}

# chain generates three certificates in a chain.
function chain() {
  rm {root,intermediate,out} -rf
  prepare root
  prepare intermediate
  prepare out

  # Create root certificate and key.
  openssl genrsa -out root/private/ca.key 2048
  openssl req -new -x509 -sha256 -days 36500 \
          -config root/openssl.cnf -extensions v3_req \
          -key root/private/ca.key --out root/certs/ca.crt \
          -subj '/CN=TEST-root'

  # Create intermediate key and request.
  openssl genrsa -out intermediate/private/intermediate.key 2048
  openssl req -new -sha256 \
          -config intermediate/openssl.cnf -extensions v3_req \
          -key intermediate/private/intermediate.key -out intermediate/certs/intermediate.csr \
          -subj '/CN=TEST-intermediate'

  # Sign intermediate request with root to create a cert.
  openssl ca -batch -notext -md sha256 \
          -config intermediate/openssl.cnf -extensions v3_req \
          -keyfile root/private/ca.key -cert root/certs/ca.crt \
          -in intermediate/certs/intermediate.csr \
          -out intermediate/certs/intermediate.crt

  # Create a key and request for an end certificate.
  openssl req -new -days 36500 -nodes -newkey rsa:2048 \
          -config out/openssl.cnf -extensions v3_req \
          -keyout out/private/localhost.key -out out/certs/localhost.csr \
          -subj "/CN=localhost"

  # Sign that with the intermediate.
  openssl ca -batch \
          -config out/openssl.cnf -extensions v3_req \
          -keyfile intermediate/private/intermediate.key -cert intermediate/certs/intermediate.crt \
          -out out/certs/localhost.crt \
          -infiles out/certs/localhost.csr

  mv out/certs/localhost.crt chain-leaf.crt
  mv out/private/localhost.key chain-leaf.key
  mv intermediate/certs/intermediate.crt chain-intermediate.crt
  mv intermediate/private/intermediate.key chain-intermediate.key
  mv root/certs/ca.crt chain-root.crt
  mv root/private/ca.key chain-root.key

  rm {out,intermediate,root} -r

  cat chain-leaf.crt chain-intermediate.crt chain-root.crt > chain.crt
  cp chain-leaf.key chain.key
}

# non-signing generates a self-signed certificate that has cert signing
# explicitly omitted.
function non-signing() {
  openssl req -x509 -nodes -newkey rsa:2048 -days 36500 \
          -keyout no-signing.key -out no-signing.crt \
          -addext "keyUsage = digitalSignature, keyEncipherment" \
          -addext "subjectAltName=DNS:localhost" \
          -subj "/CN=localhost"
}

# self-signed generates a certificate without specifying key usage.
function self-signed() {
  openssl req -x509 -nodes -newkey rsa:2048 -days 36500 \
          -keyout self-signed.key -out self-signed.crt \
          -addext "subjectAltName=DNS:localhost" \
          -subj "/CN=localhost"
}

function main() {
  local name=$1 ; shift
  "$name" "$@"
}

main "$@"
