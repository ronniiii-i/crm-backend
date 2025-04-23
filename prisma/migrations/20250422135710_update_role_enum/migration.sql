-- 1. Create new enum
CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'HOD', 'LEAD', 'STAFF');

-- 2. Convert data with cast to new enum
UPDATE "User" SET "role" = 
  CASE 
    WHEN "role" = 'ADMIN' THEN 'ADMIN'::"Role_new"
    WHEN "role" = 'MANAGER' THEN 'HOD'::"Role_new"
    WHEN "role" = 'LEAD' THEN 'LEAD'::"Role_new"
    WHEN "role" = 'USER' THEN 'STAFF'::"Role_new"
    WHEN "role" = 'GUEST' THEN 'STAFF'::"Role_new"
    ELSE NULL
  END;

-- 3. Set default value before type switch to avoid NULL issues
UPDATE "User" SET "role" = 'STAFF'::"Role_new" WHERE "role" IS NULL;

-- 4. Change column type to the new enum
ALTER TABLE "User" 
  ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");

-- 5. Drop old enum
DROP TYPE "Role";

-- 6. Rename new enum
ALTER TYPE "Role_new" RENAME TO "Role";

-- 7. Set default value
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'STAFF';
