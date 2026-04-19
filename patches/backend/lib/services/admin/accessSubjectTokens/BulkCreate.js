import Base                       from '../../Base';
import AccessSubjectToken         from '../../../models/AccessSubjectToken';
import { dumpAccessSubjectToken } from '../../utils/dumps';
import sequelize                  from '../../../sequelizeSingleton';
import Notification from '../../../models/Notification';

export default class AccessSubjectTokenBulkCreate extends Base {
    static validationRules = {
        data : [
            'required',
            {
                'list_of_objects' : [
                    {
                        name : [ 'required', 'string', 'trim', 'not_empty', { 'fixed_max_length': 255 }, { 'fixed_min_length': 1 } ],
                        code : [ 'required', 'string', 'trim', 'not_empty', { 'fixed_max_length': 255 }, { 'fixed_min_length': 1 },
                            { 'custom_error_code': [ 'WRONG_ACCESS_SUBJECT_TOKEN_CODE_FORMAT', 'like', '^[A-Z0-9]+$' ] } ]
                    }
                ]
            },
            { 'list_length_max': 500 }
        ]
    };

    async execute({ data: tokensList }) {
        const responseList = [];

        let updatedQuant = 0;

        let createdQuant = 0;

        await sequelize.transaction(async transaction => {
            for (const data of tokensList) {
                let accessSubjectToken = await AccessSubjectToken.findOne({
                    where : { code: data.code },
                    transaction
                });

                if (accessSubjectToken) {
                    await this._updateTokenName(accessSubjectToken, data.name, transaction);

                    updatedQuant += 1;
                } else {
                    accessSubjectToken = await AccessSubjectToken.create(data, { transaction });
                    await Notification.update({
                        accessSubjectTokenId : accessSubjectToken.id
                    }, {
                        where : {
                            type                 : Notification.alwaysEnabledTypes.UNKNOWN_TOKEN,
                            accessSubjectTokenId : null,
                            data                 : { tokenCode: accessSubjectToken.code }
                        },
                        transaction
                    });
                    await accessSubjectToken.updateReaderTokens({ transaction });

                    createdQuant += 1;
                }

                await accessSubjectToken.reload({ transaction });

                responseList.push(accessSubjectToken);
            }
        });

        return {
            data : responseList.map(dumpAccessSubjectToken),
            meta : {
                updatedQuant,
                createdQuant
            }
        };
    }

    async _updateTokenName(accessSubjectToken, name, transaction) {
        return accessSubjectToken.update({ name }, { transaction });
    }
}
