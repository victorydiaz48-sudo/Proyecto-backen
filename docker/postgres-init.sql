-- Bases adicionales: tests de integración y BD sombra para detectar drift de migraciones.
CREATE DATABASE reservas_test OWNER reservas;
CREATE DATABASE reservas_shadow OWNER reservas;
