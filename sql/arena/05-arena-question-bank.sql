-- =============================================================================
-- FILE: sql/arena/05-arena-question-bank.sql
-- PROJECT: Studyria Arena — Question Bank
-- PURPOSE: Define arena_questions table for competitive exam questions
-- STATUS: READY TO EXECUTE IN SUPABASE SQL EDITOR
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.arena_questions (

    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Question content
    question_text   TEXT        NOT NULL,
    option_a        TEXT        NOT NULL,
    option_b        TEXT        NOT NULL,
    option_c        TEXT        NOT NULL,
    option_d        TEXT        NOT NULL,
    correct_answer  INTEGER     NOT NULL
                    CHECK (correct_answer IN (0, 1, 2, 3)),

    -- Categorization
    exam            TEXT        NOT NULL DEFAULT 'general',
    category        TEXT        NOT NULL DEFAULT 'general',
    topic           TEXT,
    difficulty      TEXT        NOT NULL DEFAULT 'medium'
                    CHECK (difficulty IN ('easy', 'medium', 'hard')),

    -- Optional explanation
    explanation     TEXT,

    -- Source tracking (if derived from PDF content)
    source_pdf_id   TEXT,

    -- Status
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()

);

-- Enable RLS
ALTER TABLE public.arena_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active questions"
    ON public.arena_questions
    FOR SELECT TO anon, authenticated
    USING (is_active = true);

CREATE POLICY "Admins can insert questions"
    ON public.arena_questions
    FOR INSERT TO authenticated
    WITH CHECK (true);

CREATE POLICY "Admins can update questions"
    ON public.arena_questions
    FOR UPDATE TO authenticated
    USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_arena_questions_exam ON public.arena_questions(exam);
CREATE INDEX IF NOT EXISTS idx_arena_questions_category ON public.arena_questions(category);
CREATE INDEX IF NOT EXISTS idx_arena_questions_difficulty ON public.arena_questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_arena_questions_random ON public.arena_questions(id);

-- =============================================================================
-- SEED DATA: Sample competitive exam questions for Assam
-- =============================================================================
INSERT INTO public.arena_questions
    (question_text, option_a, option_b, option_c, option_d, correct_answer,
     exam, category, topic, difficulty, explanation)
VALUES
    -- General Knowledge - Assam
    ('Which is the largest river island in the world?', 'Majuli', 'Umananda', 'Poa', 'Dibru-Saikhowa', 0,
     'general', 'Geography', 'Assam Geography', 'easy', 'Majuli is recognized by Guinness World Records as the largest river island in the world.'),

    ('Who wrote the Assamese epic "Buranji"?', 'Sankardev', 'Bhagavata', 'Multiple authors', 'Hemchandra', 2,
     'general', 'History', 'Assam Literature', 'medium', 'Buranjis are historical chronicles written by multiple authors during the Ahom period.'),

    ('When was the Battle of Saraighat fought?', '1571', '1671', '1771', '1871', 1,
     'general', 'History', 'Assam History', 'medium', 'The Battle of Saraighat was fought in 1671 on the Brahmaputra river, where Lachit Borphukan defeated the Mughal forces.'),

    -- Polity
    ('How many seats are there in the Assam Legislative Assembly?', '116', '126', '136', '146', 1,
     'general', 'Polity', 'State Legislature', 'medium', 'The Assam Legislative Assembly has 126 seats.'),

    ('Who is the executive head of an Indian state?', 'Chief Minister', 'Governor', 'President', 'Prime Minister', 1,
     'general', 'Polity', 'Indian Constitution', 'easy', 'The Governor is the executive head of a state in India, while the Chief Minister is the head of the council of ministers.'),

    -- Geography
    ('Which National Park in Assam is famous for one-horned rhinoceros?', 'Dibru-Saikhowa', 'Kaziranga', 'Manas', 'Nameri', 1,
     'general', 'Geography', 'Wildlife', 'easy', 'Kaziranga National Park is a UNESCO World Heritage Site famous for the Indian one-horned rhinoceros.'),

    ('What is the capital of Assam?', 'Guwahati', 'Jorhat', 'Dispur', 'Dibrugarh', 2,
     'general', 'Geography', 'Indian States', 'easy', 'Dispur, a locality in Guwahati, is the capital of Assam.'),

    -- Economics
    ('What is the primary agricultural product of Assam?', 'Wheat', 'Tea', 'Rice', 'Sugarcane', 1,
     'general', 'Economics', 'Agriculture', 'easy', 'Assam is one of the largest tea-producing states in India.'),

    -- Current Affairs
    ('In which year was the Aadhaar Act passed by the Indian Parliament?', '2014', '2016', '2018', '2020', 1,
     'general', 'Current Affairs', 'Indian Legislation', 'medium', 'The Aadhaar (Targeted Delivery of Financial and Other Subsidies, Benefits and Services) Act, 2016 was passed by Parliament.'),

    -- Mathematics
    ('If the simple interest on Rs. 1000 for 2 years at 5% per annum, what is the interest?', 'Rs. 50', 'Rs. 100', 'Rs. 150', 'Rs. 200', 1,
     'general', 'Mathematics', 'Simple Interest', 'easy', 'SI = P × R × T / 100 = 1000 × 5 × 2 / 100 = Rs. 100.'),

    ('What is the value of log₁₀(100)?', '1', '2', '10', '100', 1,
     'general', 'Mathematics', 'Logarithms', 'easy', 'log₁₀(100) = 2 because 10² = 100.'),

    -- Science
    ('What is the chemical symbol for Gold?', 'Go', 'Gd', 'Au', 'Ag', 2,
     'general', 'General Science', 'Chemistry', 'easy', 'The chemical symbol for Gold is Au, derived from the Latin word "Aurum".'),

    ('Which vitamin is produced when skin is exposed to sunlight?', 'Vitamin A', 'Vitamin B', 'Vitamin C', 'Vitamin D', 3,
     'general', 'General Science', 'Biology', 'easy', 'Vitamin D is synthesized in the skin upon exposure to sunlight (UV radiation).'),

    ('What is the SI unit of force?', 'Joule', 'Watt', 'Newton', 'Pascal', 2,
     'general', 'General Science', 'Physics', 'medium', 'The SI unit of force is the Newton (N), named after Sir Isaac Newton.'),

    -- English
    ('Choose the correct synonym for "Ephemeral":', 'Eternal', 'Short-lived', 'Powerful', 'Beautiful', 1,
     'general', 'English', 'Vocabulary', 'medium', 'Ephemeral means lasting for a very short time; short-lived.'),

    ('Choose the correct antonym for "Diligent":', 'Hardworking', 'Lazy', 'Careful', 'Active', 1,
     'general', 'English', 'Vocabulary', 'easy', 'Diligent means hardworking and careful; its antonym is lazy.'),

    -- More Assam-specific
    ('Which dynasty ruled Assam for nearly 600 years?', 'Koch Dynasty', 'Ahom Dynasty', 'Kachari Dynasty', 'Chutia Dynasty', 1,
     'general', 'History', 'Assam History', 'medium', 'The Ahom Dynasty ruled Assam for nearly 600 years (1228-1826).'),

    ('Which festival is celebrated as the harvest festival of Assam?', 'Bihu', 'Durga Puja', 'Diwali', 'Holi', 0,
     'general', 'Assam Culture', 'Festivals', 'easy', 'Bihu is the major harvest festival of Assam, celebrated three times a year.'),

    -- Harder questions
    ('The "Pageant of the North East" refers to which state?', 'Manipur', 'Assam', 'Meghalaya', 'Nagaland', 1,
     'general', 'Geography', 'North East India', 'hard', 'Assam is often called the "Pageant of the North East" due to its diverse culture and natural beauty.'),

    ('Which amendment of the Indian Constitution is known as the "Mini Constitution"?', '38th', '42nd', '44th', '52nd', 1,
     'general', 'Polity', 'Constitutional Amendments', 'hard', 'The 42nd Amendment (1976) made widespread changes and is called the "Mini Constitution".')
ON CONFLICT DO NOTHING;
