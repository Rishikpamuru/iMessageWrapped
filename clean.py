import pandas as pd
df = pd.read_csv('name.csv')
df = df.drop(['Received', 'Date', 'iMessage'], axis=1)
df['Sender'] = df['Sender'].astype(str).str[:3]
df.to_csv('name.csv', index=False)