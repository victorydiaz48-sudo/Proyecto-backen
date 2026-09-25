-- Bases adicionales: tests de integración y BD sombra para detectar drift de migraciones.
CREATE DATABASE reservas_test OWNER reservas;
CREATE DATABASE reservas_shadow OWNER reservas;
-- Rol de la aplicación (sujeto a Row-Level Security). En producción, con una contraseña real.
CREATE ROLE reservas_app LOGIN PASSWORD 'reservas_app';
