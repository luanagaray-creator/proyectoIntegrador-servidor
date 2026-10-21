CREATE TABLE `mesages` (
  `content` text,
  `addressee` varchar(30) DEFAULT NULL,
  `priorityMesage` varchar(5) DEFAULT NULL,
  `dateMesage` decimal(8,0) DEFAULT NULL,
  `idMesage` varchar(10) NOT NULL,
  `threadId` char(10) DEFAULT NULL,
  `senderId` varchar(10) DEFAULT NULL,
  `recipientId` varchar(10) DEFAULT NULL,
  `sentAt` datetime(3) DEFAULT NULL,
  `sequence` bigint unsigned NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`idMesage`),
  UNIQUE KEY `sequence` (`sequence`),
  KEY `mesages_thread_sequence` (`threadId`,`sequence`)
) ENGINE=InnoDB AUTO_INCREMENT=33 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
