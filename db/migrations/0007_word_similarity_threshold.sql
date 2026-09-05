-- Spec 05/09 mục 5.2: toán tử q <% name_norm (word_similarity) dùng GUC này làm ngưỡng.
-- Đặt ở cấp database để user api (production), mapslibvn (dev) và DB dbtest cô lập đều cùng giá trị.
-- pg_trgm.similarity_threshold giữ mặc định 0.3 (toán tử % vẫn dùng ở conflation pipeline).
SELECT show_trgm('mapslibvn');   -- nạp thư viện pg_trgm để GUC được nhận diện/kiểm tra giá trị
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET pg_trgm.word_similarity_threshold = 0.5', current_database());
END $$;
