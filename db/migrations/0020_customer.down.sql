-- Thứ tự quan trọng: ba bảng dưới tham chiếu customer_account nên phải bỏ trước nó.
DROP TABLE IF EXISTS tenant_member;
DROP TABLE IF EXISTS customer_session;
DROP TABLE IF EXISTS customer_login_code;
DROP TABLE IF EXISTS customer_account;
ALTER TABLE tenant DROP COLUMN IF EXISTS billing_email;
ALTER TABLE tenant DROP COLUMN IF EXISTS billing_address;
ALTER TABLE tenant DROP COLUMN IF EXISTS billing_tax_code;
ALTER TABLE tenant DROP COLUMN IF EXISTS billing_name;
