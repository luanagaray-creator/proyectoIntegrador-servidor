CREATE TABLE `users` (
  `name` varchar(30) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `idUser` varchar(10) NOT NULL,
  `typeUser` varchar(12) DEFAULT NULL,
  `email` varchar(30) DEFAULT NULL,
  `cellPhone` decimal(9,0) DEFAULT NULL,
  `groupCode` varchar(7) DEFAULT NULL,
  PRIMARY KEY (`idUser`),
  UNIQUE KEY `users_name_unique` (`name`),
  UNIQUE KEY `users_email_unique` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
