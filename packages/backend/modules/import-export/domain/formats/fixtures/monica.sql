# Synthetic Monica export. No personal or credential data.
SET FOREIGN_KEY_CHECKS=0;
INSERT IGNORE INTO `contacts` (`id`,`account_id`,`first_name`,`last_name`,`uuid`,`avatar_file_name`,`avatar_photo_id`,`avatar_source`,`default_avatar_color`,`job`,`company`,`birthday_special_date_id`,`deceased_special_date_id`,`first_met_special_date_id`) VALUES
(1,7,'Ada','Example','00000000-0000-4000-8000-000000000042',NULL,5,'photo','#B3D5FE','Engineer','Example Co',8,NULL,9),
(2,7,'Zoë',NULL,NULL,NULL,NULL,'default','#123456',NULL,NULL,NULL,NULL,NULL);
INSERT IGNORE INTO `contact_field_types` (`id`,`account_id`,`name`,`type`) VALUES (1,7,'Email','email'),(2,7,'Phone','phone'),(3,7,'Social','twitter');
INSERT IGNORE INTO `contact_fields` (`id`,`account_id`,`contact_id`,`contact_field_type_id`,`data`) VALUES (1,7,1,1,'ADA@example.test'),(2,7,1,2,'+1 555 0100'),(3,7,1,3,'unsupported-handle'),(4,7,999,1,'orphan@example.test');
INSERT IGNORE INTO `places` (`id`,`account_id`,`street`,`city`,`province`,`postal_code`,`country`,`latitude`,`longitude`) VALUES (4,7,'1 Example Lane','Sampleton','Region','AB1','US',NULL,NULL);
INSERT IGNORE INTO `addresses` (`id`,`account_id`,`contact_id`,`place_id`,`name`) VALUES (1,7,1,4,'Home');
INSERT IGNORE INTO `special_dates` (`id`,`account_id`,`contact_id`,`is_age_based`,`is_year_unknown`,`date`) VALUES (8,7,1,0,1,'2000-02-29 00:00:00'),(9,7,1,0,0,'2020-04-03 00:00:00');
INSERT IGNORE INTO `notes` (`id`,`account_id`,`contact_id`,`body`,`is_favorited`,`created_at`) VALUES (1,7,1,'First note; with comma, and (parentheses).',1,'2020-01-01 00:00:00'),(2,7,1,'Second note.',0,'2020-01-02 00:00:00');
INSERT IGNORE INTO `photos` (`id`,`account_id`,`original_filename`,`new_filename`,`filesize`,`mime_type`) VALUES (5,7,'portrait.png','generated.png',123,'image/png');
INSERT IGNORE INTO `relationships` (`id`,`account_id`,`contact_is`,`of_contact`) VALUES (1,7,1,2);
INSERT IGNORE INTO `users` (`id`,`password`,`google2fa_secret`) VALUES (1,'synthetic-password','synthetic-factor');
INSERT IGNORE INTO `accounts` (`id`,`api_key`) VALUES (7,'synthetic-key');
INSERT IGNORE INTO `recovery_codes` (`id`,`recovery`) VALUES (1,'synthetic-recovery');
SET FOREIGN_KEY_CHECKS=1;
