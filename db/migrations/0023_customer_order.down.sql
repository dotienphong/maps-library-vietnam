-- payment_event tham chiếu customer_order nên phải bỏ trước.
DROP TABLE IF EXISTS payment_event;
DROP TABLE IF EXISTS customer_order;
DROP SEQUENCE IF EXISTS customer_order_code_seq;
