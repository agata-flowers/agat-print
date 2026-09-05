-- PostgreSQL requires a newly added enum value to be committed before it is used.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'FINANCE_ADMIN';
