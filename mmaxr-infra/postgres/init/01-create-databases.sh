# #!/bin/sh
# set -eu

# psql --username "$POSTGRES_USER" --dbname postgres --set=ON_ERROR_STOP=1 <<'SQL'
# CREATE DATABASE mmaxr_session_auth;
# CREATE DATABASE mmaxr_xapi_emitter;
# CREATE DATABASE mmaxr_sensor_stream;
# CREATE DATABASE mmaxr_lrs;
# CREATE DATABASE mmaxr_object_store;
# SQL

# psql --username "$POSTGRES_USER" --dbname postgres --set=ON_ERROR_STOP=1 \
#   --set=lrs_password="$LRSQL_POSTGRES_PASSWORD" <<'SQL'
# CREATE ROLE lrsql LOGIN CREATEDB PASSWORD :'lrs_password';
# CREATE DATABASE lrsql OWNER lrsql;
# SQL

# psql --username "$POSTGRES_USER" --dbname lrsql --set=ON_ERROR_STOP=1 <<'SQL'
# CREATE SCHEMA lrsql AUTHORIZATION lrsql;
# SQL

#!/bin/bash
# set -e

# psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
#     CREATE DATABASE mmaxr;
#     CREATE DATABASE lrsql;
#     CREATE USER lrsql WITH PASSWORD '$LRSQL_POSTGRES_PASSWORD';
#     GRANT ALL PRIVILEGES ON DATABASE lrsql TO lrsql;
#     ALTER DATABASE lrsql OWNER TO lrsql;
# EOSQL

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