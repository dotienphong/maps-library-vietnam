DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I RESET pg_trgm.word_similarity_threshold', current_database());
END $$;
