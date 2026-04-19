/* eslint-disable more/no-duplicated-chains */
import Base                       from '../../Base';
import AccessSubjectToken         from '../../../models/AccessSubjectToken';
import AccessSubject         from '../../../models/AccessSubject';
import { dumpAccessSubjectToken } from '../../utils/dumps';
import sequelize                  from '../../../sequelizeSingleton';
import Notification from '../../../models/Notification';
import DX from '../../../models/utils/DX';
import { NotFoundError, ForbiddenError } from '../../utils/SX';

export default class AccessSubjectTokenAttach extends Base {
    static validationRules = {
        id : [ 'required', 'db_id' ]
    };

    async execute({ id }) {
        try {
            const userId = this.cls.get('userId');

            if (!userId) throw new Error('Bad request');

            let accessSubjectToken = null;

            await sequelize.transaction(async transaction => {
                const accessSubject = await AccessSubject.findOne({
                    where : { userId }
                });

                if (!accessSubject) throw new NotFoundError(NotFoundError.codes.TAG_IS_NOT_FOUND);

                if (!accessSubject.canAttachTokens) throw new ForbiddenError(ForbiddenError.codes.ACCESS_FORBIDDEN);

                accessSubjectToken = await AccessSubjectToken.findOne({
                    where : {
                        id,
                        accessSubjectId : null
                    },
                    transaction
                });

                if (!accessSubjectToken) throw new NotFoundError(NotFoundError.codes.TAG_IS_NOT_FOUND);

                await accessSubjectToken.update({
                    accessSubjectId : accessSubject.id
                }, { transaction });
                await accessSubjectToken.updateReaderTokens({ transaction });
                await accessSubjectToken.reload({ transaction });

                await Notification.create({
                    message              : 'Subject attached token',
                    type                 : Notification.types.USER_ACTIONS.SUBJECT_ATTACHED_TOKEN,
                    accessSubjectTokenId : accessSubjectToken.id,
                    accessSubjectId      : accessSubject.id
                }, {
                    transaction
                });
            });

            return {
                data : dumpAccessSubjectToken(accessSubjectToken)
            };
        } catch (e) {
            if (e instanceof DX) {
                throw e;
            } else throw e;
        }
    }
}
