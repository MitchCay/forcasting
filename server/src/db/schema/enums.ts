import { pgEnum } from 'drizzle-orm/pg-core'
import { accountTypes, frequencies, importSources } from 'shared'

export const accountTypeEnum = pgEnum('account_type', accountTypes)
export const frequencyEnum = pgEnum('frequency', frequencies)
export const importSourceEnum = pgEnum('import_source', importSources)
