#!/bin/bash
set -e

# 1. Create the main app database and LRS database/user
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE mmaxr;
    CREATE USER lrsql WITH PASSWORD '$LRSQL_POSTGRES_PASSWORD';
    CREATE DATABASE lrsql OWNER lrsql;
EOSQL

# 2. Explicitly create the schema and grant permissions inside the LRS database
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname lrsql <<-EOSQL
    CREATE SCHEMA IF NOT EXISTS lrsql AUTHORIZATION lrsql;
    GRANT ALL ON SCHEMA lrsql TO lrsql;
    ALTER ROLE lrsql SET search_path TO lrsql;
EOSQL