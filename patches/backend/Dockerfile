# Patched Propuskator backend image.
#
# Applies fixes on top of the stock upstream backend:
#   * correct `transaction` propagation in Sequelize `findOne` calls
#     (lib/services/mobile/accessSubjectTokens/Attach{WithId,WithName}.js,
#      Detach.js, admin/accessSubjectTokens/BulkCreate.js)
#   * workspace-scoped `AccessLog.count()` in admin/accessLogs/List.js
#   * S3-upload rollback error no longer silently swallowed
#     (tokenReader/v1/accessLogs/Save.js)
#   * timezone validator accepts IANA names (Europe/Kiev, Etc/UTC, ...)
#     in addition to Windows-style labels (utils/timezones.js)
#
# See ../../README.md → "Patched backend image" for details.

ARG BASE_IMAGE=uvarovo/propuskator-backend:release
FROM ${BASE_IMAGE}

# Copy each patched file directly on top of the corresponding stock file.
COPY lib/services/mobile/accessSubjectTokens/AttachWithId.js \
     /app/lib/services/mobile/accessSubjectTokens/AttachWithId.js
COPY lib/services/mobile/accessSubjectTokens/AttachWithName.js \
     /app/lib/services/mobile/accessSubjectTokens/AttachWithName.js
COPY lib/services/mobile/accessSubjectTokens/Detach.js \
     /app/lib/services/mobile/accessSubjectTokens/Detach.js
COPY lib/services/admin/accessSubjectTokens/BulkCreate.js \
     /app/lib/services/admin/accessSubjectTokens/BulkCreate.js
COPY lib/services/admin/accessLogs/List.js \
     /app/lib/services/admin/accessLogs/List.js
COPY lib/services/tokenReader/v1/accessLogs/Save.js \
     /app/lib/services/tokenReader/v1/accessLogs/Save.js
COPY lib/services/utils/timezones.js \
     /app/lib/services/utils/timezones.js
