/* eslint-disable more/no-duplicated-chains */
import Base                       from '../../Base';
import AccessSubjectToken         from '../../../models/AccessSubjectToken';
import AccessSubject         from '../../../models/AccessSubject';
import sequelize                  from '../../../sequelizeSingleton';
import Notification from '../../../models/Notification';
import DX from '../../../models/utils/DX';
import { NotFoundError } from '../../utils/SX';

export default class AccessSubjectTokenDetach extends Base {
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

                accessSubjectToken = await AccessSubjectToken.findOne({
                    where : {
                        id,
                        accessSubjectId : accessSubject.id
                    },
                    transaction
                });

                if (!accessSubjectToken) throw new NotFoundError(NotFoundError.codes.TAG_IS_NOT_FOUND);

                await accessSubjectToken.updateReaderTokens({ transaction });
                await accessSubjectToken.update({
                    accessSubjectId : null
                }, { transaction, silent: true  });
                await accessSubjectToken.reload({ transaction });

                await Notification.create({
                    message              : 'Subject detached token',
                    type                 : Notification.types.USER_ACTIONS.SUBJECT_DETACHED_TOKEN,
                    accessSubjectTokenId : accessSubjectToken.id,
                    accessSubjectId      : accessSubject.id
                }, {
                    transaction
                });
            });

            return {};
        } catch (e) {
            if (e instanceof DX) {
                throw e;
            } else throw e;
        }
    }
}
