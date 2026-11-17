CREATE DATABASE IF NOT EXISTS skyway CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE skyway;

CREATE TABLE IF NOT EXISTS flights (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  airline VARCHAR(100) NOT NULL,
  flight_number VARCHAR(20) NOT NULL,
  origin VARCHAR(120) NOT NULL,
  origin_code CHAR(3) NOT NULL,
  destination VARCHAR(120) NOT NULL,
  destination_code CHAR(3) NOT NULL,
  departure_time DATETIME NOT NULL,
  arrival_time DATETIME NOT NULL,
  duration VARCHAR(30) NOT NULL,
  stops VARCHAR(30) NOT NULL DEFAULT 'Nonstop',
  price DECIMAL(10,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  INDEX flight_search (origin_code,destination_code,departure_time,active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(16) NOT NULL UNIQUE,
  flight_id BIGINT UNSIGNED NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  passengers TINYINT UNSIGNED NOT NULL DEFAULT 1,
  trip_type ENUM('oneway','roundtrip','multicity') NOT NULL DEFAULT 'roundtrip',
  depart_date DATE NOT NULL,
  return_date DATE NULL,
  cabin VARCHAR(30) NOT NULL DEFAULT 'Economy',
  total_price DECIMAL(10,2) NOT NULL,
  status ENUM('pending','confirmed','cancelled') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_booking_flight FOREIGN KEY (flight_id) REFERENCES flights(id),
  INDEX booking_email (email),
  INDEX booking_depart_date (depart_date)
) ENGINE=InnoDB;

-- Example JFK to LHR inventory for the demo search flow.
INSERT INTO flights (airline,flight_number,origin,origin_code,destination,destination_code,departure_time,arrival_time,duration,stops,price,currency) VALUES
('Northstar Air','NS 204','New York (JFK)','JFK','London (LHR)','LHR',DATE_ADD(CURDATE(),INTERVAL 14 DAY)+INTERVAL 8 HOUR,DATE_ADD(CURDATE(),INTERVAL 14 DAY)+INTERVAL 20 HOUR,'7h 00m','Nonstop',589.00,'USD'),
('Juniper Airways','JA 718','New York (JFK)','JFK','London (LHR)','LHR',DATE_ADD(CURDATE(),INTERVAL 14 DAY)+INTERVAL 11 HOUR,DATE_ADD(CURDATE(),INTERVAL 14 DAY)+INTERVAL 23 HOUR,'7h 10m','Nonstop',642.00,'USD'),
('Atlas Airlines','AT 931','New York (JFK)','JFK','London (LHR)','LHR',DATE_ADD(CURDATE(),INTERVAL 14 DAY)+INTERVAL 17 HOUR,DATE_ADD(CURDATE(),INTERVAL 15 DAY)+INTERVAL 5 HOUR,'7h 15m','Nonstop',718.00,'USD');
