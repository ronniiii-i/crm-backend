-- CreateEnum
CREATE TYPE "DepartmentType" AS ENUM ('ADMINISTRATION', 'HUMAN_RESOURCES', 'SALES', 'OPERATIONS', 'FINANCE', 'INFORMATION_TECHNOLOGY', 'CUSTOMER_SERVICE');

-- DropForeignKey
ALTER TABLE "Department" DROP CONSTRAINT "Department_managerId_fkey";

-- DropForeignKey
ALTER TABLE "_DepartmentMembers" DROP CONSTRAINT "_DepartmentMembers_A_fkey";

-- DropForeignKey
ALTER TABLE "_DepartmentMembers" DROP CONSTRAINT "_DepartmentMembers_B_fkey";

-- First add the type column as nullable
ALTER TABLE "Department" ADD COLUMN "type" "DepartmentType";

-- Update existing departments based on their names
UPDATE "Department" SET "type" = 'ADMINISTRATION' WHERE name = 'Administration';
UPDATE "Department" SET "type" = 'HUMAN_RESOURCES' WHERE name = 'Human Resources';
UPDATE "Department" SET "type" = 'SALES' WHERE name = 'Sales';
UPDATE "Department" SET "type" = 'OPERATIONS' WHERE name = 'Operations';
UPDATE "Department" SET "type" = 'FINANCE' WHERE name = 'Finance';
UPDATE "Department" SET "type" = 'INFORMATION_TECHNOLOGY' WHERE name = 'IT';
UPDATE "Department" SET "type" = 'CUSTOMER_SERVICE' WHERE name = 'Customer Service';

-- Now make the type column NOT NULL
ALTER TABLE "Department" ALTER COLUMN "type" SET NOT NULL;

-- Create the departmentId column in User table (not "department")
ALTER TABLE "User" ADD COLUMN "departmentId" TEXT;

-- Migrate data from _DepartmentMembers join table to direct references
UPDATE "User" u
SET "departmentId" = dm."A"
FROM "_DepartmentMembers" dm
WHERE u.id = dm."B";

-- AlterTable - Make managerId nullable
ALTER TABLE "Department" ALTER COLUMN "managerId" DROP NOT NULL;

-- Add the unique constraint on managerId in Department
ALTER TABLE "Department" ADD CONSTRAINT "Department_managerId_key" UNIQUE ("managerId");

-- Now we can safely drop the _DepartmentMembers table
DROP TABLE "_DepartmentMembers";

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;