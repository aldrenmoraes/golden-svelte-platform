# Architecture policy

Server code belongs in src/lib/server. A page component must not access PostgreSQL directly. Create domain modules with schema, repository, service, policy, and tests.
