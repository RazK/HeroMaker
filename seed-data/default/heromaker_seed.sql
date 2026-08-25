-- HeroMaker default seed database. Generated from sanitized demo branch data.
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE coupon_redemptions (
                    id TEXT PRIMARY KEY,
                    coupon_id TEXT NOT NULL REFERENCES coupons(id),
                    user_id TEXT NOT NULL REFERENCES users(id),
                    redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(coupon_id, user_id)
                );
CREATE TABLE coupons (
                    id TEXT PRIMARY KEY,
                    code TEXT UNIQUE NOT NULL,
                    credit_amount INTEGER NOT NULL,
                    expires_at TIMESTAMP,
                    is_active BOOLEAN DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                , max_uses INTEGER DEFAULT 1, current_uses INTEGER DEFAULT 0, allow_multiple_per_user BOOLEAN DEFAULT 0);
CREATE TABLE creation_steps (
	id VARCHAR NOT NULL, 
	creation_id VARCHAR NOT NULL, 
	step_name VARCHAR NOT NULL, 
	started_at DATETIME, 
	completed_at DATETIME, 
	estimated_duration INTEGER, 
	estimated_progress INTEGER, 
	estimated_completion_time DATETIME, 
	status VARCHAR, 
	error_message TEXT, 
	created_at DATETIME, 
	updated_at DATETIME, metadata JSON DEFAULT '{}', 
	PRIMARY KEY (id), 
	FOREIGN KEY(creation_id) REFERENCES creations (id)
);
INSERT INTO "creation_steps" VALUES('637f4511-f24a-45e2-8110-057cb6446634','18eaf4ce-e9db-49b0-9446-04fda6889511','image_processing','2025-12-18 09:47:28.000260','2025-12-18 09:47:28.003552',1,100,'2025-12-18 09:47:28.003552','completed',NULL,'2025-12-18 09:47:27.947041','2025-12-18 09:47:28.004328','{}');
INSERT INTO "creation_steps" VALUES('aa03e46f-7d32-4a3a-be4a-c17355e78e9b','18eaf4ce-e9db-49b0-9446-04fda6889511','openai_render','2025-12-18 09:47:28.008050','2025-12-18 09:48:05.778380',60,100,'2025-12-18 09:48:05.778380','completed',NULL,'2025-12-18 09:47:27.947056','2025-12-18 09:48:05.779332','{}');
INSERT INTO "creation_steps" VALUES('da331484-d5de-4815-aa05-fb7b99a1534a','18eaf4ce-e9db-49b0-9446-04fda6889511','meshy_3d','2025-12-18 09:48:05.782732','2025-12-18 09:51:45.040099',180,100,'2025-12-18 09:51:45.040099','completed',NULL,'2025-12-18 09:47:27.947066','2025-12-18 09:51:45.041415','{"meshy_3d_task_id": "019b30dc-1867-7a31-856c-bcaf4f44ef49"}');
INSERT INTO "creation_steps" VALUES('bbfc5dd1-908f-4c24-b462-ab0666190979','18eaf4ce-e9db-49b0-9446-04fda6889511','meshy_rig','2025-12-18 09:51:45.046277','2025-12-18 09:52:12.828785',30,100,'2025-12-18 09:52:12.828785','completed',NULL,'2025-12-18 09:47:27.947075','2025-12-18 09:52:12.829891','{}');
INSERT INTO "creation_steps" VALUES('80ca5a64-913e-4344-ad08-97c068ffd9bd','18eaf4ce-e9db-49b0-9446-04fda6889511','convert_vrm','2025-12-18 09:52:12.832548','2025-12-18 09:52:15.153214',3,100,'2025-12-18 09:52:15.153214','completed',NULL,'2025-12-18 09:47:27.947084','2025-12-18 09:52:15.154033','{}');
INSERT INTO "creation_steps" VALUES('817f7581-c0c0-4ef6-a116-3eb26755ff2c','18eaf4ce-e9db-49b0-9446-04fda6889511','complete','2025-12-18 09:52:15.156025','2025-12-18 09:52:15.157219',1,100,'2025-12-18 09:52:15.157219','completed',NULL,'2025-12-18 09:47:27.947092','2025-12-18 09:52:15.157787','{}');
INSERT INTO "creation_steps" VALUES('cd12531c-25e6-47fd-b193-a31d19c0bbb5','575f3b19-ce9a-49d0-9a90-c7b4132b53b5','image_processing','2025-12-18 10:04:13.040176','2025-12-18 10:04:13.042340',1,100,'2025-12-18 10:04:13.042340','completed',NULL,'2025-12-18 10:04:12.837642','2025-12-18 10:04:13.042931','{}');
INSERT INTO "creation_steps" VALUES('4a1fba4e-e523-4e54-9120-e6cd77fc9c03','575f3b19-ce9a-49d0-9a90-c7b4132b53b5','openai_render','2025-12-18 10:04:13.045222','2025-12-18 10:05:12.166895',60,100,'2025-12-18 10:05:12.166895','completed',NULL,'2025-12-18 10:04:12.837657','2025-12-18 10:05:12.168103','{}');
INSERT INTO "creation_steps" VALUES('cb9b73c6-5e76-4634-8165-00b54654fed7','575f3b19-ce9a-49d0-9a90-c7b4132b53b5','meshy_3d','2025-12-18 10:05:12.172161','2025-12-18 10:22:18.983776',180,100,'2025-12-18 10:22:18.983776','completed',NULL,'2025-12-18 10:04:12.837665','2025-12-18 10:22:18.984875','{"meshy_3d_task_id": "019b30eb-bd65-7a3e-a3fc-781cfb737134"}');
INSERT INTO "creation_steps" VALUES('ab8976f2-a2f6-4f40-80b4-83d3f6459b95','575f3b19-ce9a-49d0-9a90-c7b4132b53b5','meshy_rig','2025-12-18 10:22:18.987846','2025-12-18 10:29:53.138545',30,100,'2025-12-18 10:29:53.138545','completed',NULL,'2025-12-18 10:04:12.837673','2025-12-18 10:29:53.140229','{}');
INSERT INTO "creation_steps" VALUES('7157e00b-e235-4e2d-a379-0fbae1948a95','575f3b19-ce9a-49d0-9a90-c7b4132b53b5','convert_vrm','2025-12-18 10:29:53.144446','2025-12-18 10:29:55.024614',3,100,'2025-12-18 10:29:55.024614','completed',NULL,'2025-12-18 10:04:12.837681','2025-12-18 10:29:55.027041','{}');
INSERT INTO "creation_steps" VALUES('e33aea96-3db5-4420-a29d-7da7fcb23103','575f3b19-ce9a-49d0-9a90-c7b4132b53b5','complete','2025-12-18 10:29:55.029085','2025-12-18 10:29:55.030458',1,100,'2025-12-18 10:29:55.030458','completed',NULL,'2025-12-18 10:04:12.837689','2025-12-18 10:29:55.030877','{}');
INSERT INTO "creation_steps" VALUES('5c67129b-e303-4497-bf83-3dd5d8278e1d','731db45a-5119-465a-bab1-84cbc9e76ea3','image_processing','2025-12-18 10:10:04.130918','2025-12-18 10:10:04.134335',1,100,'2025-12-18 10:10:04.134335','completed',NULL,'2025-12-18 10:10:04.036176','2025-12-18 10:10:04.135588','{}');
INSERT INTO "creation_steps" VALUES('120f6b81-35c9-4de8-91e3-d2b23e87df3c','731db45a-5119-465a-bab1-84cbc9e76ea3','openai_render','2025-12-18 10:10:04.138716','2025-12-18 10:11:14.328845',60,100,'2025-12-18 10:11:14.328845','completed',NULL,'2025-12-18 10:10:04.036190','2025-12-18 10:11:14.330736','{}');
INSERT INTO "creation_steps" VALUES('4538386d-124e-44f3-b5f7-651b8d8d8e43','731db45a-5119-465a-bab1-84cbc9e76ea3','meshy_3d','2025-12-22 04:50:02.017855','2025-12-22 04:53:22.577688',180,100,'2025-12-22 04:53:22.577688','completed',NULL,'2025-12-18 10:10:04.036198','2025-12-22 04:53:22.579029','{"meshy_3d_task_id": "019b4464-9f23-7582-b4e0-98ac10a528b7"}');
INSERT INTO "creation_steps" VALUES('dbc72e18-958b-4bde-baba-384045dcd322','731db45a-5119-465a-bab1-84cbc9e76ea3','meshy_rig','2025-12-22 04:53:22.582816','2025-12-22 04:53:43.424113',30,100,'2025-12-22 04:53:43.424113','completed',NULL,'2025-12-18 10:10:04.036206','2025-12-22 04:53:43.424429','{"rig_task_id": "019b4467-aa51-76f3-91d0-e362364f9087", "walking_glb_url": "walking.glb"}');
INSERT INTO "creation_steps" VALUES('783c9bf3-d69a-4491-889d-d90198463753','731db45a-5119-465a-bab1-84cbc9e76ea3','convert_vrm','2025-12-22 04:53:43.427636','2025-12-22 04:53:45.017664',3,100,'2025-12-22 04:53:45.017664','completed',NULL,'2025-12-18 10:10:04.036213','2025-12-22 04:53:45.018478','{}');
INSERT INTO "creation_steps" VALUES('99ec7060-fe23-4e0d-95cc-0651754b49d4','731db45a-5119-465a-bab1-84cbc9e76ea3','complete','2025-12-22 04:53:45.023443','2025-12-22 04:53:45.026749',1,100,'2025-12-22 04:53:45.026749','completed',NULL,'2025-12-18 10:10:04.036221','2025-12-22 04:53:45.027429','{}');
INSERT INTO "creation_steps" VALUES('47a17a17-8f98-46c2-aba8-4a15de73f0b9','a021d49e-543f-424a-bb65-14101b62df12','image_processing','2025-12-18 10:35:43.093423','2025-12-18 10:35:43.096932',1,100,'2025-12-18 10:35:43.096932','completed',NULL,'2025-12-18 10:35:42.988172','2025-12-18 10:35:43.097748','{}');
INSERT INTO "creation_steps" VALUES('2142085c-e99b-4787-b68a-58d01eeaa5a7','a021d49e-543f-424a-bb65-14101b62df12','openai_render','2025-12-18 10:35:43.100608','2025-12-18 10:36:40.561731',60,100,'2025-12-18 10:36:40.561731','completed',NULL,'2025-12-18 10:35:42.988190','2025-12-18 10:36:40.563834','{}');
INSERT INTO "creation_steps" VALUES('11c4a56b-01fb-45ec-afd8-146ec9bfc49b','a021d49e-543f-424a-bb65-14101b62df12','meshy_3d','2025-12-18 10:36:40.568582','2025-12-18 10:40:13.822102',180,100,'2025-12-18 10:40:13.822102','completed',NULL,'2025-12-18 10:35:42.988200','2025-12-18 10:40:13.823816','{"meshy_3d_task_id": "019b3108-8c55-7aeb-a928-1ce9bd88827c"}');
INSERT INTO "creation_steps" VALUES('4dfebd87-6761-4f07-b321-7cbfaa7bb2b3','a021d49e-543f-424a-bb65-14101b62df12','meshy_rig','2025-12-18 11:19:06.819974','2025-12-18 11:19:36.730609',30,100,'2025-12-18 11:19:36.730609','completed','HTTP 422: 422 Client Error: Unprocessable Entity for url: https://api.meshy.ai/openapi/v1/rigging','2025-12-18 10:35:42.988209','2025-12-18 11:19:36.731877','{}');
INSERT INTO "creation_steps" VALUES('5563574b-bc82-41ca-aeb1-cb2242ed8b93','a021d49e-543f-424a-bb65-14101b62df12','convert_vrm','2025-12-18 11:19:36.735859','2025-12-18 11:19:38.624831',3,100,'2025-12-18 11:19:38.624831','completed',NULL,'2025-12-18 10:35:42.988218','2025-12-18 11:19:38.625728','{}');
INSERT INTO "creation_steps" VALUES('2938d554-b82f-424b-98eb-2eed2f9af2a5','a021d49e-543f-424a-bb65-14101b62df12','complete','2025-12-18 11:19:38.628114','2025-12-18 11:19:38.629230',1,100,'2025-12-18 11:19:38.629230','completed',NULL,'2025-12-18 10:35:42.988227','2025-12-18 11:19:38.629657','{}');
CREATE TABLE creations (
	id VARCHAR NOT NULL, 
	user_id VARCHAR, 
	character_name VARCHAR, 
	status VARCHAR, 
	current_task VARCHAR, 
	is_public BOOLEAN, 
	error_message TEXT, 
	metadata JSON, 
	created_at DATETIME, 
	updated_at DATETIME, 
	completed_at DATETIME, name VARCHAR, age INTEGER, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);
INSERT INTO "creations" VALUES('18eaf4ce-e9db-49b0-9446-04fda6889511','debug-user-uuid','Hairy Girl',NULL,NULL,1,NULL,'{"meshy_3d_task_id": "019b30dc-1867-7a31-856c-bcaf4f44ef49"}','2025-12-18 09:47:27.938264','2025-12-22 04:47:43.980014',NULL,'Demo User',8);
INSERT INTO "creations" VALUES('575f3b19-ce9a-49d0-9a90-c7b4132b53b5','debug-user-uuid','Superman',NULL,NULL,1,NULL,'{"meshy_3d_task_id": "019b30eb-bd65-7a3e-a3fc-781cfb737134"}','2025-12-18 10:04:12.831349','2025-12-18 10:05:14.513857',NULL,'Demo User',8);
INSERT INTO "creations" VALUES('731db45a-5119-465a-bab1-84cbc9e76ea3','debug-user-uuid','Cloudy',NULL,NULL,1,NULL,'{"meshy_3d_task_id": "019b30f1-42e5-7cca-81d9-49c35260a1e5"}','2025-12-18 10:10:04.028263','2025-12-22 04:48:12.920125',NULL,'Demo User',8);
INSERT INTO "creations" VALUES('a021d49e-543f-424a-bb65-14101b62df12','debug-user-uuid','Satan Katan',NULL,NULL,1,NULL,'{"meshy_3d_task_id": "019b3108-8c55-7aeb-a928-1ce9bd88827c"}','2025-12-18 10:35:42.980427','2025-12-22 04:48:00.703020',NULL,'Demo User',8);
CREATE TABLE migrations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
INSERT INTO "migrations" VALUES(1,'001_chatgpt_to_openai','2026-04-26 21:24:47');
INSERT INTO "migrations" VALUES(2,'002_multiuser_auth','2026-04-26 21:24:47');
INSERT INTO "migrations" VALUES(3,'003_coupon_system','2026-04-26 21:24:47');
INSERT INTO "migrations" VALUES(4,'004_coupon_max_uses','2026-04-26 21:24:47');
INSERT INTO "migrations" VALUES(5,'005_user_name_dob','2026-04-26 21:24:47');
INSERT INTO "migrations" VALUES(6,'006_tokens_to_credits','2026-04-26 21:24:47');
INSERT INTO "migrations" VALUES(7,'007_coupon_multiple_per_user','2026-04-26 21:24:47');
CREATE TABLE users (
	id VARCHAR NOT NULL, 
	email VARCHAR, 
	google_id VARCHAR, 
	username VARCHAR, 
	password_hash VARCHAR, 
	is_admin BOOLEAN, 
	subscription_tier VARCHAR, 
	created_at DATETIME, 
	updated_at DATETIME, credits INTEGER DEFAULT 0, name VARCHAR, date_of_birth DATE, 
	PRIMARY KEY (id)
);
INSERT INTO "users" VALUES('debug-user-uuid','demo@heromaker.local',NULL,'demo_user',NULL,0,'free','2025-12-13 12:48:35.314153','2025-12-13 12:48:35.314157',25,'Demo User','2000-01-01');
CREATE UNIQUE INDEX ix_users_email ON users (email);
CREATE UNIQUE INDEX ix_users_google_id ON users (google_id);
CREATE INDEX ix_creation_steps_creation_id ON creation_steps (creation_id);
CREATE INDEX ix_creation_steps_step_name ON creation_steps (step_name);
CREATE UNIQUE INDEX ix_users_username ON users(username);
CREATE INDEX ix_coupons_code ON coupons(code);
CREATE INDEX ix_coupon_redemptions_coupon_id ON coupon_redemptions(coupon_id);
CREATE INDEX ix_coupon_redemptions_user_id ON coupon_redemptions(user_id);
DELETE FROM "sqlite_sequence";
INSERT INTO "sqlite_sequence" VALUES('migrations',7);
COMMIT;
